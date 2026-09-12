import { confirmDelete } from "./confirm-delete";
import { nanoid } from "nanoid";
import { copyViewName, conflictingView } from "./view-name";
import { getVaultTemplateProperties } from "./template-properties";
import { mountNativeFilters } from "./native-filters/editor";
import { App, PluginSettingTab, Setting, Modal, ConfirmationModal, ButtonComponent, TextComponent, Menu, SearchComponent, Scope, ExtraButtonComponent, SettingGroup, SettingDefinitionItem, requireApiVersion } from "obsidian";
import CustomViewsPlugin from "./main";
import { ViewConfig, FilterGroup } from "./types";
import { settingsGroup } from "./settings-layout";
import { mountContextTemplateEditors } from "./context-template-editor";
import type { EditorView } from "@codemirror/view";
import { closeCompletion } from "@codemirror/autocomplete";
import { closeSearchPanel } from "@codemirror/search";


function editableContentDescription(): DocumentFragment {
	return createFragment(fragment => {
		fragment.appendText("When enabled, the ");
		fragment.createEl("code", { text: "{{file.content}}" });
		fragment.appendText(" area becomes an editable live editor instead of a read-only render.");
	});
}

function javaScriptDescription(): DocumentFragment {
	return createFragment(fragment => {
		fragment.appendText("When enabled, inline ");
		fragment.createEl("code", { text: "<script>" });
		fragment.appendText(" tags and per-view JS fields are executed. Disable if you only use HTML/CSS templates and want to prevent dynamic code execution.");
	});
}

const DEFAULT_RULES: FilterGroup = {
	type: "group",
	operator: "AND",
	conditions: []
};


export interface CustomViewsSettings {
	/** Original malformed configuration, retained for manual recovery. */
	recoveryData?: unknown;
	enabled: boolean;
	workInLivePreview: boolean;
	workInCanvas: boolean;
	workInPopover: boolean;
	workInEmbeds: boolean;
	editableContent: boolean;
	allowJavaScript: boolean;
	views: ViewConfig[];
}

export const DEFAULT_SETTINGS: CustomViewsSettings = {
	enabled: true,
	workInLivePreview: true,
	workInCanvas: false,
	workInPopover: false,
	workInEmbeds: false,
	editableContent: true,
	allowJavaScript: true,
	views: [
		{
			id: 'default-1',
			name: 'View 1',
			rules: JSON.parse(JSON.stringify(DEFAULT_RULES)) as FilterGroup,
			template: "<h1>{{file.basename}}</h1>\n{{file.content}}"
		}
	]
};

export class CustomViewsSettingTab extends PluginSettingTab {
	plugin: CustomViewsPlugin;
	private deleteConfirmation?: Modal;
	private viewSearch = "";
	private nameRows = new Map<string, Setting>();
	private cancelRename?: () => void;
	private renameAfterRender?: string;

	constructor(app: App, plugin: CustomViewsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		plugin.unloadSignal.addEventListener("abort", () => { this.cancelRename?.(); this.deleteConfirmation?.close(); }, { once: true });
	}


	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;

		if (key === 'workInLivePreview') {
			this.plugin.refreshAllViews();
			if (requireApiVersion("1.13.0")) {
				this.refreshDomState();
			} else {
				this.renderLegacySettings();
			}
		} else if (key === 'workInCanvas' || key === 'workInPopover' || key === 'workInEmbeds' || key === 'editableContent' || key === 'allowJavaScript') {
			this.plugin.refreshAllViews();
		}
		await this.plugin.saveSettings();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		if (!requireApiVersion("1.13.0")) return [];
		const listedViews = [...this.plugin.settings.views];

		return [
			{
				type: 'group',
				items: [
					{
						name: "Work in live preview",
						desc: "Enable to allow custom views in both live preview and reading view. Disable to limit them to reading view only.",
						control: { type: "toggle", key: "workInLivePreview" },
					},
					{
						name: "Editable content in live preview",
						desc: editableContentDescription(),
						visible: () => this.plugin.settings.workInLivePreview,
						control: { type: "toggle", key: "editableContent" },
					},
					{ name: "Work in popover preview", desc: "Apply custom views to full-note hover previews in reading and live preview modes.", control: { type: "toggle", key: "workInPopover" } },
					{ name: "Work in embedded notes", desc: "Apply custom views to full-note embeds. Heading and block embeds keep their native content.", control: { type: "toggle", key: "workInEmbeds" } },
					{
						name: "Work in canvas",
						desc: "Apply custom views to note cards in canvas, in reading view and live preview.",
						control: { type: "toggle", key: "workInCanvas" },
					},
					{
						name: "Allow JavaScript execution",
						desc: javaScriptDescription(),
						control: { type: "toggle", key: "allowJavaScript" },
					},
				],
			},
			{
				type: "list" as const,
				heading: "Views",
				search: this.viewListSearch(),
				emptyState: "No views added yet.",
				addItem: {
					name: "Add view",
					action: () => { void this.addNewViewAndEdit().catch(() => {}); },
				},
				onReorder: (oldIndex: number, newIndex: number) => {
					void this.reorderViews(oldIndex, newIndex, listedViews).catch(() => {});
				},
				items: listedViews.map((view) => ({
					// Obsidian's reconciler accepts an explicit id independently of the label.
					id: view.id,
					name: view.name,
					searchable: true,
					render: (setting: Setting) => {
						this.addViewActions(setting, view);
					},
				})),
			}
		]
	}

	// ─── Reusable helpers ─────────────────────────────────────────────────────

	hide(): void {
		this.cancelRename?.();
		this.cancelRename = undefined;
		this.nameRows.clear();
		super.hide();
	}

	private beginRename(_setting: Setting, view: ViewConfig) {
		this.cancelRename?.();
		const modal = requireApiVersion("1.13.0") ? this.createRenameModal() : new Modal(this.app);
		modal.setTitle("Rename view");
		modal.modalEl.addClass("mod-lg", "mod-form");
		const field = modal.contentEl.createDiv("form-field");
		const input = new TextComponent(field).setValue(view.name);
		input.inputEl.setAttribute("aria-label", "View name");
		const error = field.createDiv("form-field-error");
		error.setAttribute("role", "alert");
		const submit = () => {
			const name = input.getValue().trim();
			const message = !name ? "Enter a view name." : conflictingView(this.plugin.settings.views, name, view) ? "A view with this name already exists." : "";
			error.setText(message);
			field.toggleClass("is-invalid", !!message);
			input.inputEl.setAttribute("aria-invalid", String(!!message));
			if (message) return true;
			modal.close();
			if (view.name !== name) {
				view.name = name;
				this.refreshSettingsTab();
				this.plugin.refreshAllViews();
				void this.plugin.saveSettings().catch(() => {});
			}
			return false;
		};
		if (requireApiVersion("1.13.0") && modal instanceof ConfirmationModal) {
			modal.addButton(button => button.setButtonText("Rename").setCta().onClick(submit));
			modal.addCancelButton();
		} else {
			const buttons = modal.contentEl.createDiv("modal-button-container");
			new ButtonComponent(buttons).setButtonText("Rename").setCta().onClick(submit);
			new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => modal.close());
		}
		modal.scope.register([], "Enter", event => {
			if (event.isComposing || event.target !== input.inputEl) return;
			submit(); return false;
		});
		const cancel = () => modal.close();
		this.cancelRename = cancel;
		modal.onClose = () => { if (this.cancelRename === cancel) this.cancelRename = undefined; };
		modal.open();
		input.inputEl.focus();
		input.inputEl.select();
	}

	private createRenameModal(): Modal {
		if (requireApiVersion("1.13.0")) return new ConfirmationModal(this.app);
		return new Modal(this.app);
	}

	private viewListSearch() {
		// Older hosts take a component callback; newer hosts read placeholder/match.
		return Object.assign((search: SearchComponent) => this.configureViewSearch(search), {
			placeholder: "Search views...",
			match: (item: { name?: string }, query: string) => {
				this.viewSearch = query;
				return query.trim().toLowerCase().split(/\s+/).every(word => (item.name ?? "").toLowerCase().includes(word));
			},
		});
	}

	private configureViewSearch(search: SearchComponent) {
		search.setPlaceholder("Search views...").setValue(this.viewSearch).onChange(query => {
			this.viewSearch = query;
			const words = query.trim().toLowerCase().split(/\s+/);
			for (const view of this.plugin.settings.views) {
				this.nameRows.get(view.id)?.settingEl.toggle(words.every(word => view.name.toLowerCase().includes(word)));
			}
		});
	}

	private addViewActions(setting: Setting, view: ViewConfig) {
		this.nameRows.set(view.id, setting);
		setting.addExtraButton(button => button.setIcon("ellipsis").setTooltip("View actions").onClick(() => {
			const menu = new Menu();
			menu.addItem(item => item.setTitle("Edit view").setIcon("settings").onClick(() => this.openEditModal(view)));
			menu.addItem(item => item.setTitle("Rename view").setIcon("text-cursor-input").onClick(() => this.beginRename(setting, view)));
			menu.addItem(item => item.setTitle("Duplicate view").setIcon("copy").onClick(() => { void this.duplicateView(view).catch(() => {}); }));
			menu.addSeparator();
			menu.addItem(item => item.setTitle("Delete view").setIcon("trash").setWarning(true).onClick(() => this.confirmDeleteView(view)));
			const rect = button.extraSettingsEl.getBoundingClientRect();
			menu.showAtPosition({ x: rect.right, y: rect.bottom });
		}));
		setting.addToggle(toggle => toggle.setValue(view.enabled !== false)
			.setTooltip("Enable view")
			.onChange(enabled => {
				view.enabled = enabled;
				this.plugin.refreshAllViews();
				void this.plugin.saveSettings().catch(() => {});
			}));
		const remove = () => this.confirmDeleteView(view);
		setting.settingEl.addEventListener("keydown", event => {
			if (event.target !== setting.settingEl || event.isComposing || event.defaultPrevented
				|| (event.key !== "Delete" && event.key !== "Backspace")) return;
			event.preventDefault();
			remove();
		});
		if (this.renameAfterRender === view.id) {
			this.renameAfterRender = undefined;
			queueMicrotask(() => {
				if (setting.settingEl.isConnected) this.beginRename(setting, view);
			});
		}
	}

	private async duplicateView(view: ViewConfig) {
		const views = this.plugin.settings.views;
		const index = views.indexOf(view);
		if (index < 0) return;
		const duplicate = { ...structuredClone(view), id: nanoid(), name: copyViewName(views, view.name) };
		views.splice(index + 1, 0, duplicate);
		this.renameAfterRender = duplicate.id;
		this.refreshSettingsTab();
		await this.plugin.saveSettings();
	}

	private createNewView(): ViewConfig {
		return {
			id: nanoid(),
			name: "New View",
			rules: JSON.parse(JSON.stringify(DEFAULT_RULES)) as FilterGroup,
			template: "<h1>{{file.basename}}</h1>\n{{file.content}}"
		};
	}

	private async addNewViewAndEdit() {
		const newView = this.createNewView();
		this.plugin.settings.views.push(newView);
		this.refreshSettingsTab();
		this.openEditModal(newView);
		await this.plugin.saveSettings();
	}

	private confirmDeleteView(view: ViewConfig) {
		if (this.deleteConfirmation || !this.plugin.settings.views.includes(view)) return;
		const modal = confirmDelete(this.app, view.name, () => {
			void this.deleteView(view).catch(() => {});
		});
		this.deleteConfirmation = modal;
		const onClose = modal.onClose.bind(modal);
		modal.onClose = () => {
			onClose();
			this.deleteConfirmation = undefined;
		};
		modal.open();
	}

	private async deleteView(view: ViewConfig) {
		const index = this.plugin.settings.views.indexOf(view);
		if (index < 0) return;
		this.plugin.settings.views.splice(index, 1);
		this.nameRows.delete(view.id);
		this.refreshSettingsTab();
		this.plugin.refreshAllViews();
		await this.plugin.saveSettings();
	}

	private async reorderViews(oldIndex: number, newIndex: number, listedViews?: readonly ViewConfig[]) {
		const views = this.plugin.settings.views;
		if (listedViews && (listedViews.length !== views.length || listedViews.some((view, index) => view !== views[index]))) return;
		if (!Number.isInteger(oldIndex) || !Number.isInteger(newIndex) ||
			oldIndex < 0 || oldIndex >= views.length ||
			newIndex < 0 || newIndex >= views.length || oldIndex === newIndex) return;
		const [moved] = views.splice(oldIndex, 1);
		if (moved !== undefined) {
			views.splice(newIndex, 0, moved);
		}
		this.refreshSettingsTab();
		this.plugin.refreshAllViews();
		await this.plugin.saveSettings();
	}

	private openEditModal(view: ViewConfig) {
		new EditViewModal(this.app, this.plugin, view, () => {
			this.refreshSettingsTab();
			this.plugin.refreshAllViews();
		}).open();
	}

	private refreshSettingsTab() {
		this.cancelRename?.();
		this.cancelRename = undefined;
		if (requireApiVersion("1.13.0")) {
			this.update();
		} else {
			this.renderLegacySettings();
		}
	}

	display(): void {
		this.renderLegacySettings();
	}

	private renderLegacySettings(): void {
		this.cancelRename?.();
		this.cancelRename = undefined;
		this.nameRows.clear();
		const { containerEl } = this;
		containerEl.empty();

		const generalSettings: SettingGroup = new SettingGroup(containerEl);

		generalSettings.addSetting((setting: Setting) => {
			setting.setName("Work in live preview")
				.setDesc("Enable to allow custom views in both live preview and reading view. Disable to limit them to reading view only.")
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.workInLivePreview)
					.onChange(value => this.setControlValue("workInLivePreview", value).catch(() => {})));
		});


		if (this.plugin.settings.workInLivePreview) {
			generalSettings.addSetting((setting) => {
				setting
					.setName("Editable content in live preview")
					.setDesc(editableContentDescription())
					.addToggle(toggle => toggle
						.setValue(this.plugin.settings.editableContent)
						.onChange(value => this.setControlValue("editableContent", value).catch(() => {})));
			});
		}

		for (const [key, name, description] of [
			["workInPopover", "Work in popover preview", "Apply custom views to full-note hover previews in reading and live preview modes."],
			["workInEmbeds", "Work in embedded notes", "Apply custom views to full-note embeds. Heading and block embeds keep their native content."],
		] as const) {
			generalSettings.addSetting(setting => {
				setting.setName(name).setDesc(description)
					.addToggle(toggle => toggle.setValue(this.plugin.settings[key])
						.onChange(value => { void this.setControlValue(key, value).catch(() => {}); }));
			});
		}

		generalSettings.addSetting((setting: Setting) => {
			setting.setName("Work in canvas")
				.setDesc("Apply custom views to note cards in canvas, in reading view and live preview.")
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.workInCanvas)
					.onChange(value => this.setControlValue("workInCanvas", value).catch(() => {})));
		});

		generalSettings.addSetting((setting: Setting) => {
			setting
				.setName("Allow JavaScript execution")
				.setDesc(javaScriptDescription())
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.allowJavaScript)
					.onChange(value => this.setControlValue("allowJavaScript", value).catch(() => {})));
		});

		const viewsList = new SettingGroup(containerEl);
		viewsList.addSearch(search => this.configureViewSearch(search));
		viewsList.setHeading("Views")
			.addExtraButton((cb: ExtraButtonComponent) => {
				cb.setIcon("plus")
					.setTooltip("Add new view")
					.onClick(() => { void this.addNewViewAndEdit().catch(() => {}); });
			});

		if (this.plugin.settings.views.length === 0) {
			viewsList.addSetting((setting) => {
				setting.setName("No views added yet.");
			});
		}

		const listedViews = [...this.plugin.settings.views];
		listedViews.forEach((view, index) => {
			viewsList.addSetting(setting => {
				setting.setName(view.name);
				this.addViewActions(setting, view);
				for (const [icon, label, target] of [["chevron-up", "Move up", index - 1], ["chevron-down", "Move down", index + 1]] as const) {
					setting.addExtraButton(button => button.setIcon(icon).setTooltip(label)
						.setDisabled(target < 0 || target >= listedViews.length)
						.onClick(() => { void this.reorderViews(index, target, listedViews).catch(() => {}); }));
				}
			});
		});
	}

}

export class EditViewModal extends Modal {
	plugin: CustomViewsPlugin;
	view: ViewConfig;
	onClose_cb: () => void;
	private disposeFilters: (() => void) | undefined;
	private cancelNameSelection: (() => void) | undefined;
	private templateEditor: EditorView | null = null;
	private cssEditor: EditorView | null = null;
	private jsEditor: EditorView | null = null;
	private closed = false;
	private closeOnUnload = () => this.close();
	private saveChanges = () => {
		if (!this.closed && !this.plugin.unloadSignal.aborted) void this.plugin.saveSettings().catch(() => {});
	};

	constructor(app: App, plugin: CustomViewsPlugin, view: ViewConfig, onClose_cb: () => void) {
		super(app);
		this.plugin = plugin;
		this.view = view; // Edit the original directly — changes auto-save
		this.onClose_cb = onClose_cb;
		this.setTitle('Edit view');
		// Give editor popups first refusal before the parent modal's Escape handler.
		this.scope = new Scope(this.scope);
		(this.scope as Scope & { setTabFocusContainerEl?: (el: HTMLElement) => void }).setTabFocusContainerEl?.(this.modalEl);
		this.scope.register([], "Escape", () => {
			const editor = [this.templateEditor, this.cssEditor, this.jsEditor].find(editor => editor?.hasFocus);
			if (!editor || (!closeCompletion(editor) && !closeSearchPanel(editor))) this.close();
			return false;
		});
		this.plugin.unloadSignal.addEventListener("abort", this.closeOnUnload, { once: true });
	}


	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("cv-edit-view-modal");
		if (requireApiVersion("1.13.0")) this.modalEl.addClass("cv-template-modal");

		const templateVariables = getVaultTemplateProperties(this.app);
		const autoSave = this.saveChanges;

		const identity = settingsGroup(contentEl);
		new Setting(identity)
			.setName("Enable view")
			.setDesc("Apply this view to matching notes. Turn off to keep its templates without applying them.")
			.addToggle(toggle => toggle.setValue(this.view.enabled !== false).onChange(enabled => {
				this.view.enabled = enabled;
				this.plugin.refreshAllViews();
				autoSave();
			}));
		new Setting(identity)
			.setName("View name")
			.setDesc("The name of the view will be displayed in the view selector.")
			.addText(text => {
				text.setValue(this.view.name)
					.onChange((value) => {
						this.view.name = value;
						autoSave();
					});
				this.selectFocusedName(text.inputEl);
			});

		const displayOptions = settingsGroup(contentEl, "Display options");
		new Setting(displayOptions)
			.setName("Show navigation bar")
			.setDesc("Show back/forward buttons and the note path in reading view and live preview.")
			.addToggle(toggle => toggle
				.setValue(this.view.showNavigationBar ?? true)
				.onChange(value => {
					this.view.showNavigationBar = value;
					autoSave();
				}));

		// Native editor properties and inline title only apply to editable content.
		if (this.plugin.settings.editableContent) {
			const obsidianShowInlineTitle = (this.app.vault as unknown as {
				getConfig(key: string): unknown;
			}).getConfig("showInlineTitle") as boolean;


			new Setting(displayOptions)
				.setName("Show properties in editing view")
				.setDesc("Show the properties/metadata section in live preview. Properties are always hidden in reading view.")
				.addToggle(toggle => toggle
					.setValue(this.view.showProperties ?? true)
					.onChange((value) => {
						this.view.showProperties = value;
						autoSave();
					}));

			if (obsidianShowInlineTitle) {
				new Setting(displayOptions)
					.setName("Show inline title in editing view")
					.setDesc("Show the inline title in live preview. The inline title is always hidden in reading view.")
					.addToggle(toggle => toggle
						.setValue(this.view.showInlineTitle ?? true)
						.onChange((value) => {
							this.view.showInlineTitle = value;
							autoSave();
						}));
			}
		}

		const rulesContainer = settingsGroup(contentEl, "Rules").createDiv({ cls: "cv-native-filter-host" });

		this.disposeFilters = mountNativeFilters(this.app, rulesContainer, this.view, autoSave);


		if (!this.plugin.settings.allowJavaScript) contentEl.createEl("p", { text: "JavaScript execution is disabled in the plugin settings." });
		Object.assign(this, mountContextTemplateEditors(contentEl, this.view, templateVariables, this.plugin.settings.allowJavaScript, autoSave));
	}

	private selectFocusedName(input: HTMLInputElement) {
		this.cancelNameSelection?.();
		const ownerWindow = input.ownerDocument.defaultView;
		if (!ownerWindow || this.closed) return;
		const frame = ownerWindow.requestAnimationFrame(() => {
			this.cancelNameSelection = undefined;
			if (!this.closed && input.isConnected && input.ownerDocument.activeElement === input) input.select();
		});
		this.cancelNameSelection = () => ownerWindow.cancelAnimationFrame(frame);
	}


	onClose() {
		if (this.closed) return;
		this.closed = true;
		this.cancelNameSelection?.();
		this.cancelNameSelection = undefined;
		this.plugin.unloadSignal.removeEventListener("abort", this.closeOnUnload);
		const cleanups = [
			this.disposeFilters,
			...[this.templateEditor, this.cssEditor, this.jsEditor].map(editor => editor ? () => editor.destroy() : undefined),
		];
		this.disposeFilters = undefined;
		this.templateEditor = this.cssEditor = this.jsEditor = null;
		for (const cleanup of cleanups) {
			try { cleanup?.(); }
			catch (error) { console.error("[Custom Views] Could not clean up a settings editor:", error); }
		}
		const { contentEl } = this;
		contentEl.empty();
		if (!this.plugin.unloadSignal.aborted) this.onClose_cb();
	}
}
