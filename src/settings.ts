import { nanoid } from "nanoid";
import { inferTemplatePropertyType } from "./template-properties";
import { mountNativeFilters } from "./native-filters/editor";
import { App, PluginSettingTab, Setting, TextComponent, Modal, ExtraButtonComponent, SettingGroup, SettingDefinitionItem, requireApiVersion } from "obsidian";
import CustomViewsPlugin from "./main";
import { ViewConfig, FilterGroup } from "./types";
import { createTemplateEditor } from "./editor";
import type { TemplateVariable } from "./editor";
import type { EditorView } from "@codemirror/view";
import { EditorState, StateEffect } from "@codemirror/state";


const DEFAULT_RULES: FilterGroup = {
	type: "group",
	operator: "AND",
	conditions: []
};


export interface CustomViewsSettings {
	enabled: boolean;
	workInLivePreview: boolean;
	workInCanvas: boolean;
	editableContent: boolean;
	allowJavaScript: boolean;
	views: ViewConfig[];
}

export const DEFAULT_SETTINGS: CustomViewsSettings = {
	enabled: true,
	workInLivePreview: true,
	workInCanvas: false,
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

	constructor(app: App, plugin: CustomViewsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}


	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();

		if (key === 'workInLivePreview') {
			this.plugin.refreshAllViews();
			if (requireApiVersion("1.13.0")) {
				this.refreshDomState();
			}
		} else if (key === 'workInCanvas' || key === 'editableContent' || key === 'allowJavaScript') {
			this.plugin.refreshAllViews();
		}
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
						desc: "When enabled, the {{file.content}} area becomes an editable live editor instead of a read-only render.",
						visible: () => this.plugin.settings.workInLivePreview,
						control: { type: "toggle", key: "editableContent" },
					},
					{
						name: "Work in canvas (experimental)",
						control: { type: "toggle", key: "workInCanvas" },
					},
					{
						name: "Allow JavaScript execution",
						desc: "When enabled, inline <script> tags and per-view JS fields are executed. Disable if you only use HTML/CSS templates and want to prevent dynamic code execution.",
						control: { type: "toggle", key: "allowJavaScript" },
					},
				],
			},
			{
				type: "list" as const,
				heading: "Views",
				emptyState: "No views added yet.",
				addItem: {
					name: "Add view",
					action: () => { void this.addNewViewAndEdit(); },
				},
				onReorder: (oldIndex: number, newIndex: number) => {
					void this.reorderViews(oldIndex, newIndex);
				},
				onDelete: (index: number) => {
					const view = listedViews[index];
					if (view) void this.deleteView(view).then(() => this.refreshSettingsTab());
				},
				items: listedViews.map((view) => ({
					// Obsidian's reconciler accepts an explicit id independently of the label.
					id: view.id,
					name: view.name,
					searchable: true,
					render: (setting: Setting) => {
						setting.addExtraButton((btn) =>
							btn
								.setIcon("square-pen")
								.setTooltip("Edit " + view.name)
								.onClick(() => this.openEditModal(view))
						);
					},
				})),
			}
		]
	}

	// ─── Reusable helpers ─────────────────────────────────────────────────────

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
		await this.plugin.saveSettings();
		this.refreshSettingsTab();
		this.openEditModal(newView);
	}

	private async deleteView(view: ViewConfig) {
		const index = this.plugin.settings.views.indexOf(view);
		if (index < 0) return;
		this.plugin.settings.views.splice(index, 1);
		await this.plugin.saveSettings();
		this.plugin.refreshAllViews();
	}

	private async reorderViews(oldIndex: number, newIndex: number) {
		const views = this.plugin.settings.views;
		if (!Number.isInteger(oldIndex) || !Number.isInteger(newIndex) ||
			oldIndex < 0 || oldIndex >= views.length ||
			newIndex < 0 || newIndex >= views.length || oldIndex === newIndex) return;
		const [moved] = views.splice(oldIndex, 1);
		if (moved !== undefined) {
			views.splice(newIndex, 0, moved);
		}
		await this.plugin.saveSettings();
		this.plugin.refreshAllViews();
	}

	private openEditModal(view: ViewConfig) {
		new EditViewModal(this.app, this.plugin, view, () => {
			this.refreshSettingsTab();
			this.plugin.refreshAllViews();
		}).open();
	}

	private refreshSettingsTab() {
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
		const { containerEl } = this;
		containerEl.empty();

		const generalSettings: SettingGroup = new SettingGroup(containerEl);

		generalSettings.addSetting((setting: Setting) => {
			setting.setName("Work in live preview")
				.setDesc("Enable to allow custom views in both live preview and reading view. Disable to limit them to reading view only.")
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.workInLivePreview)
					.onChange(async (value) => {
						this.plugin.settings.workInLivePreview = value;
						await this.plugin.saveSettings();
						this.plugin.refreshAllViews();
						this.renderLegacySettings();
					}));
		});

		if (this.plugin.settings.workInLivePreview) {
			generalSettings.addSetting((setting) => {
				setting
					.setName("Editable content in live preview")
					.setDesc("When enabled, the {{file.content}} area becomes an editable live editor instead of a read-only render.")
					.addToggle(toggle => toggle
						.setValue(this.plugin.settings.editableContent)
						.onChange(async (value) => {
							this.plugin.settings.editableContent = value;
							await this.plugin.saveSettings();
							this.plugin.refreshAllViews();
						}));
			});
		}

		generalSettings.addSetting((setting: Setting) => {
			setting.setName("Work in canvas (experimental)")
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.workInCanvas)
					.onChange(async (value) => {
						this.plugin.settings.workInCanvas = value;
						await this.plugin.saveSettings();
						this.plugin.refreshAllViews();
					}));
		});

		generalSettings.addSetting((setting: Setting) => {
			setting
				.setName("Allow JavaScript execution")
				.setDesc("When enabled, inline <script> tags and per-view JS fields are executed. Disable if you only use HTML/CSS templates and want to prevent dynamic code execution.")
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.allowJavaScript)
					.onChange(async (value) => {
						this.plugin.settings.allowJavaScript = value;
						await this.plugin.saveSettings();
						this.plugin.refreshAllViews();
					}));
		});

		const viewsList = new SettingGroup(containerEl);
		viewsList.setHeading("Views")
			.addExtraButton((cb: ExtraButtonComponent) => {
				cb.setIcon("plus")
					.setTooltip("Add new view")
					.onClick(() => { void this.addNewViewAndEdit(); });
			});

		if (this.plugin.settings.views.length === 0) {
			viewsList.addSetting((setting) => {
				setting.setName("No views added yet.");
			});
		}

		this.plugin.settings.views.forEach((view, index) => {
			viewsList.addSetting((setting) => {
				setting
					.setName(view.name)
					.addExtraButton((cb: ExtraButtonComponent) => {
						cb.setIcon("chevron-up")
							.setTooltip("Move up")
							.onClick(async () => {
								await this.reorderViews(index, index - 1);
								this.renderLegacySettings();
							});
					})
					.addExtraButton((cb: ExtraButtonComponent) => {
						cb.setIcon("chevron-down")
							.setTooltip("Move down")
							.onClick(async () => {
								await this.reorderViews(index, index + 1);
								this.renderLegacySettings();
							});
					})
					.addExtraButton((cb: ExtraButtonComponent) => {
						cb.setIcon("square-pen")
							.setTooltip("Edit " + view.name)
							.onClick(() => this.openEditModal(view));
					})
					.addExtraButton((cb: ExtraButtonComponent) => {
						cb.setIcon("trash")
							.setTooltip("Delete " + view.name)
							.onClick(async () => {
								await this.deleteView(view);
								this.renderLegacySettings();
							});
					});
			});
		});
	}

}

export class EditViewModal extends Modal {
	plugin: CustomViewsPlugin;
	view: ViewConfig;
	onClose_cb: () => void;
	private disposeFilters: (() => void) | undefined;
	private nameTextComponent: TextComponent | null = null;
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
		this.plugin.unloadSignal.addEventListener("abort", this.closeOnUnload, { once: true });
	}

	/** Scans the vault for frontmatter properties with their types (for template autocomplete icons) */
	private getVaultProperties(): TemplateVariable[] {
		const propMap = new Map<string, TemplateVariable["type"]>();
		const files = this.app.vault.getMarkdownFiles();

		// Access Obsidian's undocumented metadataTypeManager for assigned types.
		const typeManager = (this.app as {
			metadataTypeManager?: { getAssignedType?(key: string): string | undefined };
		}).metadataTypeManager;

		const obsidianTypeMap: Record<string, TemplateVariable["type"]> = {
			"text": "text", "number": "number", "date": "date",
			"datetime": "datetime", "checkbox": "checkbox",
			"tags": "list", "aliases": "list", "multitext": "list",
		};

		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter) {
				for (const [key, val] of Object.entries(cache.frontmatter)) {
					if (key === "position") continue;
					if (propMap.has(key) && propMap.get(key) !== "unknown") continue;

					// Try Obsidian's assigned type first
					if (typeManager?.getAssignedType) {
						const obsType = typeManager.getAssignedType(key);
						if (obsType && obsidianTypeMap[obsType]) {
							propMap.set(key, obsidianTypeMap[obsType]);
							continue;
						}
					}

					propMap.set(key, inferTemplatePropertyType(val));
				}
			}
		}

		return Array.from(propMap.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, type]) => ({ name, type }));
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("cv-edit-view-modal");

		const templateVariables = this.getVaultProperties();
		const autoSave = this.saveChanges;

		new Setting(contentEl)
			.setName("View name")
			.setDesc("The name of the view will be displayed in the view selector.")
			.addText(text => {
				this.nameTextComponent = text;
				text.setValue(this.view.name)
					.onChange((value) => {
						this.view.name = value;
						autoSave();
					});
				window.requestAnimationFrame(() => {
					text.inputEl.select();
				});
			});

		// Display options — only shown when editableContent is enabled
		if (this.plugin.settings.editableContent) {
			const obsidianShowInlineTitle = (this.app.vault as unknown as {
				getConfig(key: string): unknown;
			}).getConfig("showInlineTitle") as boolean;

			contentEl.createEl("h3", { text: "Display options" });

			new Setting(contentEl)
				.setName("Show properties in editing view")
				.setDesc("Show the properties/metadata section in live preview. Properties are always hidden in reading view.")
				.addToggle(toggle => toggle
					.setValue(this.view.showProperties ?? true)
					.onChange((value) => {
						this.view.showProperties = value;
						autoSave();
					}));

			if (obsidianShowInlineTitle) {
				new Setting(contentEl)
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

		contentEl.createEl("h3", { text: "Rules" });
		const rulesContainer = contentEl.createDiv({ cls: "cv-native-filter-host" });

		this.disposeFilters = mountNativeFilters(this.app, rulesContainer, this.view, autoSave);

		contentEl.createEl("h3", { text: "Template" });

		contentEl.createEl("h4", { text: "HTML" });
		const templateContainer = contentEl.createDiv({ cls: "cv-codemirror-container" });
		this.templateEditor = createTemplateEditor({
			initialContent: this.view.template,
			language: "html",
			templateVariables,
			root: templateContainer.ownerDocument,
			onChange: (content: string) => {
				this.view.template = content;
				autoSave();
			},
		});
		templateContainer.appendChild(this.templateEditor.dom);

		contentEl.createEl("h4", { text: "CSS" });
		const cssContainer = contentEl.createDiv({ cls: "cv-codemirror-container" });
		this.cssEditor = createTemplateEditor({
			initialContent: this.view.css ?? "",
			language: "css",
			templateVariables,
			root: cssContainer.ownerDocument,
			onChange: (content: string) => {
				this.view.css = content;
				autoSave();
			},
		});
		cssContainer.appendChild(this.cssEditor.dom);

		contentEl.createEl("h4", { text: "JavaScript" });
		const jsDisabled = !this.plugin.settings.allowJavaScript;
		if (jsDisabled) {
			contentEl.createEl("p", {
				text: "JavaScript execution is disabled. Enable it in the plugin settings to use this feature.",
				cls: "cv-js-disabled-notice",
			});
		}
		const jsContainer = contentEl.createDiv({ cls: "cv-codemirror-container" });
		this.jsEditor = createTemplateEditor({
			initialContent: this.view.js ?? "",
			language: "javascript",
			templateVariables,
			root: jsContainer.ownerDocument,
			onChange: (content: string) => {
				this.view.js = content;
				autoSave();
			},
		});
		jsContainer.appendChild(this.jsEditor.dom);
		if (jsDisabled) {
			jsContainer.addClass("cv-editor-disabled");
			this.jsEditor.dispatch({
				effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)),
			});
		}
	}

	onClose() {
		if (this.closed) return;
		this.closed = true;
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
