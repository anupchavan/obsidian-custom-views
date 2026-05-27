import { App, PluginSettingTab, Setting, TextComponent, setIcon, Modal, FuzzySuggestModal, FuzzyMatch } from "obsidian";
import CustomViewsPlugin from "./main";
import { ViewConfig, FilterGroup, Filter, FilterOperator, FilterConjunction } from "./types";
import { createTemplateEditor } from "./editor";
import type { TemplateVariable } from "./editor";
import { FileSuggest, FolderSuggest, TagSuggest, PropertySuggest, FrontmatterValueSuggest, isWikilink, extractWikilinkTarget, extractWikilinkDisplay, openWikilinkFile } from "./suggests";
import type { EditorView } from "@codemirror/view";
import { EditorState, StateEffect } from "@codemirror/state";


type PropertyType = "text" | "number" | "date" | "datetime" | "list" | "checkbox" | "file" | "unknown";

const TYPE_ICONS: Record<PropertyType, string> = {
	text: "text",
	number: "binary",
	date: "calendar",
	datetime: "clock",
	list: "list",
	checkbox: "check-square",
	file: "file",
	unknown: "text"
};

/**
 * Operator sets by type. Field-specific overrides take priority (see FIELD_OPERATORS).
 */
const TYPE_OPERATORS: Record<string, string[]> = {
	text: ["is", "is not", "starts with", "ends with", "is empty", "contains any of", "contains all of", "does not start with", "does not end with", "is not empty", "does not contain", "does not contain any of", "does not contain all of"],
	list: ["is exactly", "is not exactly", "is empty", "contains", "contains any of", "contains all of", "is not empty", "does not contain", "does not contain any of", "does not contain all of"],
	number: ["=", "≠", "<", "≤", ">", "≥", "is empty", "is not empty"],
	date: ["on", "not on", "before", "on or before", "after", "on or after", "is empty", "is not empty"],
	checkbox: ["is", "is not"],
};

/**
 * Field-specific operator overrides. These take priority over TYPE_OPERATORS.
 */
const FIELD_OPERATORS: Record<string, string[]> = {
	"file": ["links to", "in folder", "has tag", "has property", "does not link to", "is not in folder", "does not have tag", "does not have property"],
	"file.name": ["is", "is not", "starts with", "ends with", "is empty", "contains", "contains any of", "contains all of", "does not start with", "does not end with", "is not empty", "does not contain", "does not contain any of", "does not contain all of"],
	"file.folder": ["is", "is not", "starts with", "ends with", "is empty", "contains", "contains any of", "contains all of", "does not start with", "does not end with", "is not empty", "does not contain", "does not contain any of", "does not contain all of"],
};

/**
 * Returns the operator list for a given field and type.
 * Field-specific overrides take priority, then type-based lookup.
 */
function getOperatorsForField(field: string, type: PropertyType): string[] {
	if (FIELD_OPERATORS[field]) return FIELD_OPERATORS[field];
	const opsKey = type === "datetime" ? "date" : (type === "unknown" ? "text" : type);
	return TYPE_OPERATORS[opsKey] || TYPE_OPERATORS["text"];
}

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
	editableContent: false,
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
	private draggedElement: HTMLElement | null = null;
	private draggedIndex: number | null = null;

	constructor(app: App, plugin: CustomViewsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Work in live preview")
			.setDesc("Enable to allow custom views in both live preview and reading view. Disable to limit them to reading view only.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.workInLivePreview)
				.onChange(async (value) => {
					this.plugin.settings.workInLivePreview = value;
					await this.plugin.saveSettings();
					this.plugin.refreshAllViews();
					this.display();
				}));

		new Setting(containerEl)
			.setName("Work in canvas (experimental)")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.workInCanvas)
				.onChange(async (value) => {
					this.plugin.settings.workInCanvas = value;
					await this.plugin.saveSettings();
					this.plugin.refreshAllViews();
				}));

		if (this.plugin.settings.workInLivePreview) {
			new Setting(containerEl)
				.setName("Editable content in live preview (experimental)")
				.setDesc("When enabled, the {{file.content}} area becomes an editable live editor instead of a read-only render.")
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.editableContent)
					.onChange(async (value) => {
						this.plugin.settings.editableContent = value;
						await this.plugin.saveSettings();
						this.plugin.refreshAllViews();
					}));
		}

		new Setting(containerEl)
			.setName("Allow JavaScript execution")
			.setDesc("When enabled, inline <script> tags and per-view JS fields are executed. Disable if you only use HTML/CSS templates and want to prevent dynamic code execution.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.allowJavaScript)
				.onChange(async (value) => {
					this.plugin.settings.allowJavaScript = value;
					await this.plugin.saveSettings();
					this.plugin.refreshAllViews();
				}));





		new Setting(containerEl)
			.setHeading()
			.setName("Views configuration")
			.setDesc("Views are checked in order from top to bottom. Drag to reorder.")
			.addButton(btn => btn
				.setButtonText("Add new view")
				.setCta()
				.onClick(async () => {
					const newView: ViewConfig = {
						id: `${Date.now()}`,
						name: "New View",
						rules: JSON.parse(JSON.stringify(DEFAULT_RULES)) as FilterGroup,
						template: "<h1>{{file.basename}}</h1>\n{{file.content}}"
					};
					this.plugin.settings.views.push(newView);
					await this.plugin.saveSettings();
					this.display();

					const newIndex = this.plugin.settings.views.length - 1;
					new EditViewModal(this.app, this.plugin, newView, newIndex, () => {
						this.display();
						this.plugin.refreshAllViews();
					}).open();
				}));

		const viewsListContainer = containerEl.createDiv({ cls: "cv-views-list-container" });

		this.plugin.settings.views.forEach((view, index) => {
			this.renderViewListItem(viewsListContainer, view, index);
		});
	}

	renderViewListItem(container: HTMLElement, view: ViewConfig, index: number) {
		const listItem = container.createDiv({ cls: "cv-view-list-item" });
		listItem.setAttribute("data-view-id", view.id);
		listItem.setAttribute("data-view-index", index.toString());
		listItem.draggable = true;

		const dragHandle = listItem.createDiv({ cls: "cv-view-drag-handle" });
		setIcon(dragHandle, "grip-vertical");

		listItem.createSpan({ cls: "cv-view-name", text: view.name });

		const actionsContainer = listItem.createDiv({ cls: "cv-view-actions" });

		const editBtn = actionsContainer.createDiv({ cls: "clickable-icon" });
		setIcon(editBtn, "pencil");
		editBtn.setAttribute("aria-label", "Edit view");
		editBtn.onclick = (e) => {
			e.stopPropagation();
			new EditViewModal(this.app, this.plugin, view, index, () => {
				this.display();
				this.plugin.refreshAllViews();
			}).open();
		};

		const deleteBtn = actionsContainer.createDiv({ cls: "clickable-icon" });
		setIcon(deleteBtn, "trash-2");
		deleteBtn.setAttribute("aria-label", "Delete view");
		deleteBtn.onclick = async (e) => {
			e.stopPropagation();
			this.plugin.settings.views.splice(index, 1);
			await this.plugin.saveSettings();
			this.display();
			this.plugin.refreshAllViews();
		};

		listItem.addEventListener("dragstart", (e) => {
			if (!e.dataTransfer) return;
			e.dataTransfer.effectAllowed = "move";
			this.draggedElement = listItem;
			this.draggedIndex = index;
			listItem.addClass("cv-dragging");
			container.querySelectorAll(".cv-view-list-item").forEach((el) => {
				el.removeClass("cv-drag-over");
			});
		});

		listItem.addEventListener("dragend", () => {
			listItem.removeClass("cv-dragging");
			container.querySelectorAll(".cv-view-list-item").forEach((el) => {
				el.removeClass("cv-drag-over");
			});
			this.draggedElement = null;
			this.draggedIndex = null;
		});

		listItem.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (!e.dataTransfer || !this.draggedElement || this.draggedIndex === null) return;
			e.dataTransfer.dropEffect = "move";

			if (listItem === this.draggedElement) return;

			listItem.addClass("cv-drag-over");
		});

		listItem.addEventListener("dragleave", () => {
			listItem.removeClass("cv-drag-over");
		});

		listItem.addEventListener("drop", (e) => {
			e.preventDefault();
			if (!e.dataTransfer || !this.draggedElement || this.draggedIndex === null) return;

			if (listItem === this.draggedElement) {
				listItem.removeClass("cv-drag-over");
				return;
			}

			const draggedView = this.plugin.settings.views[this.draggedIndex];
			const allItems = Array.from(container.querySelectorAll(".cv-view-list-item"));
			const targetIndex = allItems.indexOf(listItem);

			if (targetIndex === -1) return;

			this.plugin.settings.views.splice(this.draggedIndex, 1);
			this.plugin.settings.views.splice(targetIndex, 0, draggedView);

			void this.plugin.saveSettings();
			this.display();
		});
	}
}

class EditViewModal extends Modal {
	plugin: CustomViewsPlugin;
	view: ViewConfig;
	viewIndex: number;
	onClose_cb: () => void;
	private nameTextComponent: TextComponent | null = null;
	private templateEditor: EditorView | null = null;
	private cssEditor: EditorView | null = null;
	private jsEditor: EditorView | null = null;

	constructor(app: App, plugin: CustomViewsPlugin, view: ViewConfig, viewIndex: number, onClose_cb: () => void) {
		super(app);
		this.plugin = plugin;
		this.view = view; // Edit the original directly — changes auto-save
		this.viewIndex = viewIndex;
		this.onClose_cb = onClose_cb;
		this.setTitle('Edit view');
	}

	/** Scans the vault for frontmatter properties with their types (for template autocomplete icons) */
	private getVaultProperties(): TemplateVariable[] {
		const propMap = new Map<string, TemplateVariable["type"]>();
		const files = this.app.vault.getMarkdownFiles();

		// Access Obsidian's undocumented metadataTypeManager for assigned types
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
		const typeManager = (this.app as any).metadataTypeManager;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
		const hasTypeManager = typeManager && typeof typeManager.getAssignedType === "function";

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
					if (hasTypeManager) {
						// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
						const obsType = typeManager.getAssignedType(key) as string | undefined;
						if (obsType && obsidianTypeMap[obsType]) {
							propMap.set(key, obsidianTypeMap[obsType]);
							continue;
						}
					}

					// Fall back to value inference
					if (val === null || val === undefined) {
						propMap.set(key, "unknown");
					} else if (Array.isArray(val)) {
						propMap.set(key, "list");
					} else if (typeof val === "number") {
						propMap.set(key, "number");
					} else if (typeof val === "boolean") {
						propMap.set(key, "checkbox");
					} else if (typeof val === "string") {
						if (/^\d{4}-\d{2}-\d{2}T/.test(val)) propMap.set(key, "datetime");
						else if (/^\d{4}-\d{2}-\d{2}$/.test(val)) propMap.set(key, "date");
						else propMap.set(key, "text");
					} else {
						propMap.set(key, "text");
					}
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
		const autoSave = () => { void this.plugin.saveSettings(); };

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
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
			const obsidianShowInlineTitle = (this.app.vault as any).getConfig("showInlineTitle") as boolean;

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
		const rulesContainer = contentEl.createDiv({ cls: "cv-bases-query-container" });

		const builder = new FilterBuilder(
			this.plugin,
			this.view.rules,
			autoSave,
			() => { rulesContainer.empty(); builder.render(rulesContainer); }
		);
		builder.render(rulesContainer);

		contentEl.createEl("h3", { text: "Template" });

		contentEl.createEl("h4", { text: "HTML" });
		const templateContainer = contentEl.createDiv({ cls: "cv-codemirror-container" });
		this.templateEditor = createTemplateEditor({
			initialContent: this.view.template,
			language: "html",
			templateVariables,
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
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- quoting exact setting name
				text: "JavaScript execution is disabled. Enable \"Allow JavaScript execution\" in the plugin settings to use this feature.",
				cls: "cv-js-disabled-notice",
			});
		}
		const jsContainer = contentEl.createDiv({ cls: "cv-codemirror-container" });
		this.jsEditor = createTemplateEditor({
			initialContent: this.view.js ?? "",
			language: "javascript",
			templateVariables,
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
		if (this.templateEditor) {
			this.templateEditor.destroy();
			this.templateEditor = null;
		}
		if (this.cssEditor) {
			this.cssEditor.destroy();
			this.cssEditor = null;
		}
		if (this.jsEditor) {
			this.jsEditor.destroy();
			this.jsEditor = null;
		}
		const { contentEl } = this;
		contentEl.empty();
		this.onClose_cb();
	}
}

interface PropertyDef {
	key: string;
	type: PropertyType;
}

interface ComboboxItem {
	label: string;
	value: string;
	icon?: string;
}

/**
 * Unified combobox modal for property and operator selection.
 */
class ComboboxSuggestModal extends FuzzySuggestModal<ComboboxItem> {
	private items: ComboboxItem[];
	private selectedValue: string;
	private onSelect: (val: string) => void;
	private anchorEl: HTMLElement | null = null;
	private clickOutsideHandler: ((evt: MouseEvent) => void) | null = null;

	constructor(
		app: App,
		items: ComboboxItem[],
		selectedValue: string,
		onSelect: (val: string) => void,
		anchorEl?: HTMLElement
	) {
		super(app);
		this.items = items;
		this.selectedValue = selectedValue;
		this.onSelect = onSelect;
		this.anchorEl = anchorEl || null;
	}

	getItems(): ComboboxItem[] {
		return this.items;
	}

	getItemText(item: ComboboxItem): string {
		return item.label;
	}

	onOpen() {
		void super.onOpen();

		// Style modal as combobox
		window.requestAnimationFrame(() => {
			const modalContainer = this.modalEl.closest('.modal-container');
			if (modalContainer) {
				modalContainer.addClass('cv-modal-container');
				modalContainer.removeClass('mod-dim');
				const modalBg = modalContainer.querySelector('.modal-bg');
				if (modalBg) {
					(modalBg as HTMLElement).addClass('cv-modal-bg-hidden');
				}
			}
		});

		this.modalEl.addClass("cv-suggestion-container", "cv-combobox");

		// Position relative to anchor element
		if (this.anchorEl) {
			const rect = this.anchorEl.getBoundingClientRect();
			this.modalEl.addClass('cv-combobox-positioned');
			// Use CSS custom properties for dynamic positioning (setProperty is acceptable for CSS variables)
			this.modalEl.style.setProperty('--cv-combobox-left', `${rect.left}px`);
			this.modalEl.style.setProperty('--cv-combobox-top', `${rect.bottom + 5}px`);
		}

		// Style input and container
		const promptEl = this.modalEl.querySelector('.prompt-input-container');
		if (promptEl) {
			promptEl.addClass("cv-search-input-container");
			// Render search icon via Obsidian API (avoids CSS mask-image)
			const searchIcon = createEl("div", { cls: "cv-search-icon" });
			setIcon(searchIcon, "search");
			promptEl.prepend(searchIcon);
			const input = promptEl.querySelector('input');
			if (input) {
				input.setAttribute('type', 'search');
				input.setAttribute('placeholder', 'Search...');

				// Show/hide clear button based on input text
				const updateClearButtonVisibility = () => {
					const clearButton = promptEl.querySelector('.search-input-clear-button') as HTMLElement;
					if (clearButton) {
						if (input.value.trim().length > 0) {
							clearButton.removeClass('cv-clear-button-hidden');
							clearButton.addClass('cv-clear-button-visible');
						} else {
							clearButton.removeClass('cv-clear-button-visible');
							clearButton.addClass('cv-clear-button-hidden');
						}
					}
				};

				// Initial state - use requestAnimationFrame to ensure DOM is ready
				window.requestAnimationFrame(() => {
					updateClearButtonVisibility();
				});

				// Update on input change
				input.addEventListener('input', updateClearButtonVisibility);

				// Tab: select highlighted and advance. Shift+Tab: close and focus previous combobox.
				input.addEventListener('keydown', (e) => {
					if (e.key !== 'Tab') return;
					e.preventDefault();
					if (e.shiftKey) {
						this.close();
						const prev = this.anchorEl?.previousElementSibling as HTMLElement;
						if (prev) prev.focus();
					} else {
						const highlighted = this.modalEl.querySelector('.suggestion-item.is-selected') as HTMLElement;
						if (highlighted) highlighted.click();
						else this.close();
					}
				});
			}
		}

		const suggestionsEl = this.modalEl.querySelector('.suggestion-container');
		if (suggestionsEl) {
			suggestionsEl.addClass("cv-suggestion");
		}

		// Keep anchor focused
		if (this.anchorEl) {
			if (this.anchorEl.getAttribute('tabindex') === '-1') {
				this.anchorEl.setAttribute('tabindex', '0');
			}
			window.requestAnimationFrame(() => {
				this.anchorEl?.focus();
			});
		}

		// Click-outside handler
		this.clickOutsideHandler = (evt: MouseEvent) => {
			const target = evt.target as Node;
			const isOutsideModal = !this.modalEl.contains(target) && this.modalEl !== target;
			const isNotAnchor = this.anchorEl !== target && !this.anchorEl?.contains(target);
			if (isOutsideModal && isNotAnchor) {
				this.close();
			}
		};

		window.setTimeout(() => {
			activeDocument.addEventListener('mousedown', this.clickOutsideHandler!);
		}, 0);
	}

	renderSuggestion(match: FuzzyMatch<ComboboxItem>, el: HTMLElement): void {
		const item = match.item;
		el.addClass("cv-suggestion-item", "cv-mod-complex", "cv-mod-toggle");

		if (item.value === this.selectedValue) {
			const checkIcon = el.createDiv({ cls: "cv-suggestion-icon cv-mod-checked" });
			setIcon(checkIcon, "check");
		}

		if (item.icon) {
			const iconDiv = el.createDiv({ cls: "cv-suggestion-icon" });
			const flair = iconDiv.createSpan({ cls: "cv-suggestion-flair" });
			setIcon(flair, item.icon);
		}

		const content = el.createDiv({ cls: "cv-suggestion-content" });
		content.createDiv({ cls: "cv-suggestion-title", text: item.label });
	}

	onChooseItem(item: ComboboxItem): void {
		this.onSelect(item.value);
	}

	onClose() {
		if (this.clickOutsideHandler) {
			activeDocument.removeEventListener('mousedown', this.clickOutsideHandler);
			this.clickOutsideHandler = null;
		}

		// Remove focus class from button and cv-filter-statement
		if (this.anchorEl) {
			// Find the cv-filter-expression element that contains the anchor
			const expression = this.anchorEl.closest('.cv-filter-expression') as HTMLElement;
			removeFocusClasses(this.anchorEl, expression);
		}

		const modalContainer = this.modalEl.closest('.modal-container');
		if (modalContainer) {
			modalContainer.removeClass('cv-modal-container');
			modalContainer.addClass('mod-dim');
			const modalBg = modalContainer.querySelector('.modal-bg');
			if (modalBg) {
				(modalBg as HTMLElement).removeClass('cv-modal-bg-hidden');
			}
		}
		super.onClose();
	}
}

/**
 * Helper functions for UI component creation
 */
function createComboboxButton(
	container: HTMLElement,
	label: string,
	icon?: string
): HTMLElement {
	const button = container.createDiv({ cls: "cv-combobox-button", attr: { tabindex: "0" } });

	if (icon) {
		const iconEl = button.createDiv({ cls: "cv-combobox-button-icon" });
		setIcon(iconEl, icon);
	}

	const labelEl = button.createDiv({ cls: "cv-combobox-button-label" });
	labelEl.innerText = label;
	setIcon(button.createDiv({ cls: "cv-combobox-button-chevron" }), "chevrons-up-down");

	return button;
}

function createDeleteButton(
	container: HTMLElement,
	onClick: (e: MouseEvent) => void
): HTMLElement {
	const deleteBtn = container.createEl("button", {
		cls: "clickable-icon",
		attr: { "aria-label": "Remove filter" }
	});
	setIcon(deleteBtn, "trash-2");
	deleteBtn.onclick = (e) => {
		e.stopPropagation();
		onClick(e);
	};
	return deleteBtn;
}

function addFocusClasses(button: HTMLElement, parent: HTMLElement): void {
	button.addClass("cv-has-focus");
	parent.addClass("cv-has-focus");
}

function removeFocusClasses(button: HTMLElement | null, parent: HTMLElement | null): void {
	if (button) {
		button.removeClass("cv-has-focus");
	}
	if (parent) {
		parent.removeClass("cv-has-focus");
	}
}

function createFilterValueInput(
	container: HTMLElement,
	type: PropertyType,
	value: string | undefined,
	onChange: (val: string) => void,
	operator?: string,
	app?: App,
	field?: string
): HTMLInputElement | HTMLElement {
	const safeValue = value || "";
	const needsMultiSelect = operator === "contains any of" || operator === "does not contain any of"
		|| operator === "contains all of" || operator === "does not contain all of"
		|| operator === "is exactly" || operator === "is not exactly"
		|| operator === "has tag" || operator === "does not have tag";
	if (needsMultiSelect) {
		// Multi-select container for operators that accept multiple values
		const multiSelectContainer = container.createDiv({ cls: "cv-multi-select-container", attr: { tabindex: "-1" } });

		// Parse existing values (comma-separated)
		const values: string[] = safeValue ? safeValue.split(",").map(v => v.trim()).filter(v => v.length > 0) : [];

		// Create contenteditable input
		const input = multiSelectContainer.createDiv({
			cls: "cv-multi-select-input",
			attr: {
				contenteditable: "true",
				tabindex: "0",
				"data-placeholder": "Empty"
			}
		});

		// Focus input when clicking on container (but not on child elements)
		multiSelectContainer.addEventListener("click", (e: MouseEvent) => {
			// Only focus if clicking directly on the container, not on pills or input
			if (e.target === multiSelectContainer) {
				e.preventDefault();
				input.focus();
			}
		});

		// Helper to update placeholder based on pill count
		const updatePlaceholder = (): void => {
			if (values.length === 0) {
				input.setAttribute("data-placeholder", "Empty");
			} else {
				input.setAttribute("data-placeholder", "");
			}
		};

		// Helper to get all pills in order
		const getPills = (): HTMLElement[] => {
			return Array.from(multiSelectContainer.querySelectorAll(".multi-select-pill"));
		};

		// Helper to get the index of a pill
		const getPillIndex = (pill: HTMLElement): number => {
			return getPills().indexOf(pill);
		};

		// Helper to focus a pill by index
		const focusPill = (index: number): void => {
			const pills = getPills();
			if (index >= 0 && index < pills.length) {
				pills[index].focus();
			}
		};

		// Helper to focus the last pill
		const focusLastPill = (): void => {
			const pills = getPills();
			if (pills.length > 0) {
				pills[pills.length - 1].focus();
			}
		};

		// Helper to focus the input
		const focusInput = (): void => {
			input.focus();
		};

		// Helper to clear input and ensure placeholder shows
		const clearInput = () => {
			input.textContent = "";
			// Remove any <br> tags that might prevent :empty from working
			const br = input.querySelector("br");
			if (br) br.remove();
		};

		// Mutable reference for inline suggest (assigned later)
		let inlineSuggest: FileSuggest | FolderSuggest | TagSuggest | PropertySuggest | FrontmatterValueSuggest | null = null;

		// Handle keyboard navigation in input
		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				const text = input.textContent?.trim() || "";
				if (text.length > 0) {
					values.push(text);
					onChange(values.join(","));
					updatePills();
					clearInput();
					updatePlaceholder();
					// Focus back to input after creating pill
					window.requestAnimationFrame(() => focusInput());
				}
			} else if (e.key === "Tab" && !e.shiftKey) {
				// Accept the highlighted inline suggestion if open
				if (inlineSuggest?.selectHighlighted()) {
					e.preventDefault();
				}
			} else if (e.key === "Backspace" || e.key === "ArrowLeft") {
				// If input is empty, focus the last pill
				const text = input.textContent?.trim() || "";
				if (text.length === 0) {
					e.preventDefault();
					focusLastPill();
				}
			}
		});

		// Handle paste to split by comma/newline
		input.addEventListener("paste", (e: ClipboardEvent) => {
			e.preventDefault();
			const pastedText = e.clipboardData?.getData("text") || "";
			const newValues = pastedText.split(/[,\n]/).map(v => v.trim()).filter(v => v.length > 0);
			if (newValues.length > 0) {
				values.push(...newValues);
				onChange(values.join(","));
				updatePills();
				clearInput();
				updatePlaceholder();
			}
		});

		// Helper to set up pill keyboard navigation
		const setupPillNavigation = (pill: HTMLElement): void => {
			pill.addEventListener("keydown", (e: KeyboardEvent) => {
				const currentIndex = getPillIndex(pill);
				if (e.key === "Backspace" || e.key === "Delete") {
					e.preventDefault();
					e.stopPropagation();
					if (currentIndex > -1 && currentIndex < values.length) {
						values.splice(currentIndex, 1);
						onChange(values.join(","));
						updatePills();
						// Focus previous pill or input
						if (values.length > 0) {
							const newIndex = Math.max(0, currentIndex - 1);
							window.requestAnimationFrame(() => focusPill(newIndex));
						} else {
							window.requestAnimationFrame(() => focusInput());
						}
					}
				} else if ((e.key === "Tab" && !e.shiftKey) || e.key === "ArrowRight") {
					e.preventDefault();
					const pills = getPills();
					// Focus next pill or input if last pill
					if (currentIndex < pills.length - 1) {
						focusPill(currentIndex + 1);
					} else {
						focusInput();
					}
				} else if (e.key === "ArrowLeft") {
					e.preventDefault();
					// Focus previous pill; wrap to input if first pill
					if (currentIndex > 0) {
						focusPill(currentIndex - 1);
					} else {
						focusInput();
					}
				} else if (e.key === "Tab" && e.shiftKey) {
					// Focus previous pill, or let default Tab bubble out to previous combobox
					if (currentIndex > 0) {
						e.preventDefault();
						focusPill(currentIndex - 1);
					}
					// else: don't preventDefault — let browser move focus to previous element
				}
			});
		};

		// Function to update pills (defined here to access navigation functions)
		const updatePills = (): void => {
			// Remove all pills (but keep the input)
			const pills = multiSelectContainer.querySelectorAll(".multi-select-pill");
			pills.forEach(pill => pill.remove());

			// Recreate pills with navigation handlers
			values.forEach((val, index) => {
				createPill(multiSelectContainer, val, () => {
					if (index > -1 && index < values.length) {
						values.splice(index, 1);
						onChange(values.join(","));
						updatePills();
						updatePlaceholder();
						// After deletion, focus the previous pill or input
						if (values.length > 0) {
							const newIndex = Math.min(index, values.length - 1);
							window.requestAnimationFrame(() => focusPill(newIndex));
						} else {
							window.requestAnimationFrame(() => focusInput());
						}
					}
				}, (pill: HTMLElement) => {
					setupPillNavigation(pill);
				}, app);
			});

			// Ensure input is last
			multiSelectContainer.appendChild(input);
			// Update placeholder after pills are updated
			updatePlaceholder();
		};

		// Initial render of pills
		updatePills();
		// Set initial placeholder
		updatePlaceholder();

		// Accept text on blur (with delay to avoid conflict with suggest selection)
		let blurTimeout: number | null = null;
		const acceptInputText = (): void => {
			const text = input.textContent?.trim() || "";
			if (text.length > 0) {
				values.push(text);
				onChange(values.join(","));
				updatePills();
				clearInput();
				updatePlaceholder();
			}
		};
		input.addEventListener("blur", () => {
			blurTimeout = window.setTimeout(() => {
				blurTimeout = null;
				acceptInputText();
			}, 150);
		});

		// Attach inline suggestions for multi-select inputs
		if (app) {
			const addPillFromSuggest = (text: string): void => {
				// Cancel pending blur acceptance — suggest takes priority
				if (blurTimeout) { window.clearTimeout(blurTimeout); blurTimeout = null; }
				if (text.trim().length > 0 && !values.includes(text.trim())) {
					values.push(text.trim());
					onChange(values.join(","));
					updatePills();
					clearInput();
					updatePlaceholder();
					window.requestAnimationFrame(() => focusInput());
				}
			};

			const suggest = createSuggestForInput(app, input, operator, field);
			if (suggest) {
				suggest.setExcludeValues(values);
				suggest.onSelectCb(addPillFromSuggest);
				inlineSuggest = suggest;
			}
		}

		return multiSelectContainer;
	} else if (type === "date" || type === "datetime") {
		const input = container.createEl("input", {
			type: type === "datetime" ? "datetime-local" : "date",
			value: safeValue,
			attr: {
				max: type === "datetime" ? "9999-12-31T23:59" : "9999-12-31"
			}
		});
		input.oninput = () => onChange(input.value);
		return input;
	} else if (type === "number") {
		const input = container.createEl("input", { type: "number", value: safeValue });
		input.oninput = () => onChange(input.value);
		return input;
	} else {
		// For wikilink values, render like Obsidian bases: metadata-link with pencil flair
		if (isWikilink(safeValue) && app) {
			const input = container.createEl("input", { type: "text", value: safeValue });
			input.addClass("metadata-input", "metadata-input-text");
			input.placeholder = "Value...";
			input.oninput = () => onChange(input.value);

			const linkTarget = extractWikilinkTarget(safeValue);
			const resolved = app.metadataCache.getFirstLinkpathDest(linkTarget, "");

			const metadataLink = container.createDiv({ cls: "metadata-link" });
			const linkEl = metadataLink.createDiv({
				cls: "metadata-link-inner internal-link",
				text: extractWikilinkDisplay(safeValue),
				attr: { "data-href": linkTarget, draggable: "true" }
			});
			if (!resolved) linkEl.addClass("is-unresolved");
			const flair = metadataLink.createDiv({ cls: "metadata-link-flair" });
			setIcon(flair, "pencil");

			const enterEditMode = () => {
				metadataLink.addClass("cv-hidden");
				input.removeClass("cv-hidden");
				input.focus();
				input.select();
			};

			// Click link text → open file in background
			linkEl.addEventListener("click", (e) => {
				e.stopPropagation();
				openWikilinkFile(app, extractWikilinkTarget(input.value));
			});

			// Click pencil or anywhere else on metadata-link → enter edit mode
			flair.addEventListener("click", (e) => { e.stopPropagation(); enterEditMode(); });
			metadataLink.addEventListener("click", enterEditMode);

			// When input loses focus, restore link display if value is still a wikilink
			input.addEventListener("blur", () => {
				if (isWikilink(input.value)) {
					metadataLink.removeClass("cv-hidden");
					input.addClass("cv-hidden");
					const newTarget = extractWikilinkTarget(input.value);
					const newResolved = app.metadataCache.getFirstLinkpathDest(newTarget, "");
					linkEl.setText(extractWikilinkDisplay(input.value));
					linkEl.setAttribute("data-href", newTarget);
					if (newResolved) linkEl.removeClass("is-unresolved");
					else linkEl.addClass("is-unresolved");
				}
			});

			// Start with link visible, input hidden
			input.addClass("cv-hidden");

			// Attach inline suggestions
			const suggest = createSuggestForInput(app, input, operator, field);
			if (suggest) {
				suggest.onSelectCb((text: string) => {
					input.value = text;
					input.dispatchEvent(new Event("input"));
					onChange(text);
				});
			}

			return container;
		}

		const input = container.createEl("input", { type: "text", value: safeValue });
		input.addClass("metadata-input", "metadata-input-text");
		input.placeholder = "Value...";
		input.oninput = () => onChange(input.value);

		// Attach inline suggestions for single-value text inputs
		if (app) {
			const suggest = createSuggestForInput(app, input, operator, field);
			if (suggest) {
				suggest.onSelectCb((text: string) => {
					input.value = text;
					input.dispatchEvent(new Event("input"));
					onChange(text);
				});
			}
		}

		return input;
	}
}

/**
 * Creates the appropriate suggest provider based on the field.
 * Returns the suggest instance or null if no suggest is applicable.
 */
function createSuggestForInput(
	app: App,
	inputEl: HTMLInputElement | HTMLDivElement,
	operator?: string,
	field?: string
): FileSuggest | FolderSuggest | TagSuggest | PropertySuggest | FrontmatterValueSuggest | null {
	if (!field) return null;

	// Field-based suggest mapping
	if (field === "file links") return new FileSuggest(app, inputEl);
	if (field === "file.folder") return new FolderSuggest(app, inputEl);
	if (field === "file tags") return new TagSuggest(app, inputEl);
	if (field === "aliases") return new FrontmatterValueSuggest(app, inputEl, "aliases");

	// Legacy support for old "file" field operators
	if (field === "file") {
		if (operator === "links to" || operator === "does not link to") return new FileSuggest(app, inputEl);
		if (operator === "in folder" || operator === "is not in folder") return new FolderSuggest(app, inputEl);
		if (operator === "has tag" || operator === "does not have tag") return new TagSuggest(app, inputEl);
		if (operator === "has property" || operator === "does not have property") return new PropertySuggest(app, inputEl);
		return null;
	}

	// For frontmatter property values — suggest existing values
	// Skip built-in file.* properties (file.name, file.path, etc.)
	if (!field.startsWith("file.") && field !== "file links" && field !== "file tags") {
		return new FrontmatterValueSuggest(app, inputEl, field);
	}

	return null;
}

function createPill(container: HTMLElement, value: string, onRemove: () => void, onCreated?: (pill: HTMLElement) => void, app?: App): void {
	const pill = container.createDiv({ cls: "multi-select-pill", attr: { tabindex: "0" } });

	// Detect wikilinks and render with internal-link styling
	if (isWikilink(value) && app) {
		pill.addClass("cv-pill-wikilink");
		const linkTarget = extractWikilinkTarget(value);
		const resolved = app.metadataCache.getFirstLinkpathDest(linkTarget, "");
		const contentEl = pill.createDiv({ cls: "multi-select-pill-content internal-link" });
		if (!resolved) contentEl.addClass("is-unresolved");
		contentEl.setAttribute("data-href", linkTarget);
		contentEl.setText(extractWikilinkDisplay(value));

		// Click on content opens the file
		contentEl.addEventListener("click", (e) => {
			e.stopPropagation();
			e.preventDefault();
			openWikilinkFile(app, linkTarget);
		});
	} else {
		pill.createDiv({ cls: "multi-select-pill-content", text: value });
	}

	const removeButton = pill.createDiv({ cls: "multi-select-pill-remove-button" });
	setIcon(removeButton, "x");
	removeButton.onclick = (e) => {
		e.stopPropagation();
		onRemove();
	};
	if (onCreated) {
		onCreated(pill);
	}
}


function setupComboboxButtonHandlers(
	button: HTMLElement,
	parent: HTMLElement,
	onOpen: () => void
): void {
	button.onclick = (e) => {
		e.preventDefault();
		e.stopPropagation();
		onOpen();
	};

	button.onkeydown = (e) => {
		if (e.key === " ") {
			e.preventDefault();
			e.stopPropagation();
			onOpen();
		}
	};
}

export class FilterBuilder {
	plugin: CustomViewsPlugin;
	root: FilterGroup;
	onSave: () => void;
	onRefresh: () => void;
	onDeleteView?: () => void;
	availableProperties: PropertyDef[];
	/** Pending auto-open action after refresh. Consumed by renderFilterRow. */
	private pendingAutoOpen: { filter: Filter; action: "operator" | "value" } | null = null;

	constructor(plugin: CustomViewsPlugin, root: FilterGroup, onSave: () => void, onRefresh: () => void, onDeleteView?: () => void) {
		this.plugin = plugin;
		this.root = root;
		this.onSave = onSave;
		this.onRefresh = onRefresh;
		this.onDeleteView = onDeleteView;
		this.availableProperties = this.scanVaultProperties();
	}

	/**
	 * Gets the display label for a property key
	 */
	getPropertyLabel(key: string): string {
		const labelMap: Record<string, string> = {
			"file.name": "file name",
			"file.path": "file path",
			"file.folder": "folder",
			"file.size": "file size",
			"file.ctime": "created time",
			"file.mtime": "modified time",
			"file links": "file links",
		};
		return labelMap[key] || key;
	}

	/**
	 * Gets the icon for a property
	 */
	getPropertyIcon(key: string, type: PropertyType): string {
		if (key === "file links") return "link";
		if (key === "file tags") return "tags";
		if (key === "aliases") return "forward";
		if (key === "file.ctime" || key === "file.mtime") return "clock";
		return TYPE_ICONS[type] || "pilcrow";
	}

	/**
	 * Gets the Obsidian-assigned type for a property key from the internal
	 * metadataTypeManager registry. Returns null if not available.
	 */
	private getObsidianPropertyType(key: string): PropertyType | null {
		// Accessing undocumented Obsidian internal API
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
		const typeManager = (this.plugin.app as any).metadataTypeManager;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		if (!typeManager || typeof typeManager.getAssignedType !== "function") return null;

		// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		const obsidianType = typeManager.getAssignedType(key) as string | undefined;
		if (!obsidianType) return null;

		// Map Obsidian's internal type names to our PropertyType
		const typeMap: Record<string, PropertyType> = {
			"text": "text",
			"number": "number",
			"date": "date",
			"datetime": "datetime",
			"checkbox": "checkbox",
			"tags": "list",
			"aliases": "list",
			"multitext": "list",
		};

		return typeMap[obsidianType] || null;
	}

	/**
	 * Scans the vault to find properties and their types.
	 * Uses Obsidian's metadataTypeManager when available, falls back to inference.
	 */
	scanVaultProperties(): PropertyDef[] {
		const app = this.plugin.app;
		const propMap = new Map<string, PropertyType>();

		// Define built-in properties in the desired order
		const builtInProps: Array<[string, PropertyType]> = [
			["file", "file"],
			["file.name", "text"],
			["file.path", "text"],
			["file.folder", "text"],
			["file.ctime", "date"],
			["file.mtime", "date"],
			["file.size", "number"],
			["file links", "list"],
			["file tags", "list"],
			["aliases", "list"]
		];

		// Add built-in properties
		for (const [key, type] of builtInProps) {
			propMap.set(key, type);
		}

		// Scan frontmatter properties
		const files = app.vault.getMarkdownFiles();
		for (const file of files) {
			const cache = app.metadataCache.getFileCache(file);
			if (cache?.frontmatter) {
				for (const key of Object.keys(cache.frontmatter)) {
					if (key === "position" || key === "tags" || key === "aliases") continue;
					if (propMap.has(key) && propMap.get(key) !== "unknown") continue;

					// Prefer Obsidian's assigned type over inference
					const obsidianType = this.getObsidianPropertyType(key);
					if (obsidianType) {
						propMap.set(key, obsidianType);
					} else {
						const val = cache.frontmatter[key] as string | number | boolean | string[] | undefined;
						const type = this.inferType(val);
						propMap.set(key, type);
					}
				}
			}
		}

		// Separate built-in and custom properties
		const builtInKeys = new Set(builtInProps.map(([key]) => key));
		const builtIn: PropertyDef[] = [];
		const custom: PropertyDef[] = [];

		for (const [key, type] of propMap.entries()) {
			const def = { key, type };
			if (builtInKeys.has(key)) {
				builtIn.push(def);
			} else {
				custom.push(def);
			}
		}

		// Sort built-in by the defined order, custom alphabetically
		builtIn.sort((a, b) => {
			const aIndex = builtInProps.findIndex(([key]) => key === a.key);
			const bIndex = builtInProps.findIndex(([key]) => key === b.key);
			return aIndex - bIndex;
		});
		custom.sort((a, b) => a.key.localeCompare(b.key));

		return [...builtIn, ...custom];
	}

	inferType(val: unknown): PropertyType {
		if (val === null || val === undefined) return "unknown";
		if (Array.isArray(val)) return "list";
		if (typeof val === "number") return "number";
		if (typeof val === "boolean") return "checkbox";
		if (typeof val === "string") {
			if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return "date";
			if (/^\d{4}-\d{2}-\d{2}T/.test(val)) return "datetime";
		}
		return "text";
	}

	getPropertyType(key: string): PropertyType {
		const def = this.availableProperties.find(p => p.key === key);
		return def ? def.type : "text";
	}

	render(container: HTMLElement) {
		this.renderGroup(container, this.root, true);
	}

	renderGroup(container: HTMLElement, group: FilterGroup, isRoot: boolean = false) {
		const groupDiv = container.createDiv({ cls: "filter-group" });
		const header = groupDiv.createDiv({ cls: "filter-group-header" });

		const labelMap: Record<string, string> = {
			"AND": "All the following are true",
			"OR": "Any of the following are true",
			"NOR": "None of the following are true"
		};

		const valueMap: Record<string, string> = {
			"AND": "and",
			"OR": "or",
			"NOR": "not"
		};
		const reverseValueMap: Record<string, FilterConjunction> = {
			"and": "AND",
			"or": "OR",
			"not": "NOR"
		};

		const select = header.createEl("select", {
			cls: "conjunction dropdown",
			attr: { value: valueMap[group.operator] || "and" }
		});

		select.createEl("option", {
			attr: { value: "and" },
			text: labelMap["AND"]
		});
		select.createEl("option", {
			attr: { value: "or" },
			text: labelMap["OR"]
		});
		select.createEl("option", {
			attr: { value: "not" },
			text: labelMap["NOR"]
		});

		select.value = valueMap[group.operator] || "and";

		select.onchange = () => {
			group.operator = reverseValueMap[select.value];
			this.onSave();
			this.onRefresh();
		};


		const statementsContainer = groupDiv.createDiv({ cls: "filter-group-statements" });

		// If conditions is empty, show a default empty rule
		if (group.conditions.length === 0) {
			const rowWrapper = statementsContainer.createDiv({ cls: "filter-row" });
			const conjLabel = rowWrapper.createSpan({ cls: "conjunction" });
			conjLabel.innerText = "Where";

			// Create a temporary placeholder filter
			const placeholderFilter: Filter = { type: "filter", field: "file", operator: "links to", value: "" };
			this.renderFilterRow(rowWrapper, placeholderFilter, group, -1, true);
		} else {
			group.conditions.forEach((condition, index) => {
				const rowWrapper = statementsContainer.createDiv({ cls: "filter-row" });
				const conjLabel = rowWrapper.createSpan({ cls: "conjunction" });
				if (index === 0) {
					conjLabel.innerText = "Where";
				} else {
					conjLabel.innerText = (group.operator === "OR" || group.operator === "NOR") ? "or" : "and";
				}

				if (condition.type === "group") {
					rowWrapper.addClass("mod-group");
					this.renderGroup(rowWrapper, condition);

					const h = rowWrapper.querySelector(".filter-group-header");
					if (h) {
						const headerActionsDiv = h.createDiv({ cls: "filter-group-header-actions" });
						createDeleteButton(headerActionsDiv, () => {
							group.conditions.splice(index, 1);
							this.onSave();
							this.onRefresh();
						});
					}
				} else {
					this.renderFilterRow(rowWrapper, condition, group, index);
				}
			});
		}

		const actionsDiv = groupDiv.createDiv({ cls: "filter-group-actions" });
		this.createSimpleBtn(actionsDiv, "plus", "Add filter", () => {
			group.conditions.push({ type: "filter", field: "file", operator: "links to", value: "" });
			this.onSave(); this.onRefresh();
		});
		this.createSimpleBtn(actionsDiv, "plus", "Add filter group", () => {
			group.conditions.push({ type: "group", operator: "AND", conditions: [] });
			this.onSave(); this.onRefresh();
		});
	}

	renderFilterRow(row: HTMLElement, filter: Filter, parentGroup: FilterGroup, index: number, isPlaceholder: boolean = false) {
		const statement = row.createDiv({ cls: "cv-filter-statement" });
		const expression = statement.createDiv({ cls: "cv-filter-expression metadata-property" });

		const currentType = this.getPropertyType(filter.field);

		// Track if this placeholder has been added to the conditions array
		let placeholderAdded = false;

		const propertyBtn = createComboboxButton(
			expression,
			this.getPropertyLabel(filter.field),
			this.getPropertyIcon(filter.field, currentType)
		);

		const openPropertyModal = () => {
			addFocusClasses(propertyBtn, expression);
			this.openCombobox(
				this.availableProperties.map(p => ({
					label: this.getPropertyLabel(p.key),
					value: p.key,
					icon: this.getPropertyIcon(p.key, p.type)
				})),
				filter.field,
				(newVal) => {
					const newType = this.getPropertyType(newVal);
					const newOperator = getOperatorsForField(newVal, newType)[0] as FilterOperator;

					// If this is a placeholder, add it to the conditions array
					if (isPlaceholder && !placeholderAdded) {
						parentGroup.conditions.push({
							type: "filter",
							field: newVal,
							operator: newOperator,
							value: ""
						});
						placeholderAdded = true;
					} else if (isPlaceholder && placeholderAdded) {
						// Update the filter in the conditions array
						const conditionIndex = parentGroup.conditions.length - 1;
						if (conditionIndex >= 0 && parentGroup.conditions[conditionIndex].type === "filter") {
							const conditionFilter = parentGroup.conditions[conditionIndex];
							conditionFilter.field = newVal;
							conditionFilter.operator = newOperator;
							conditionFilter.value = "";
						}
					} else {
						filter.field = newVal;
						filter.operator = newOperator;
						filter.value = "";
					}

					// Auto-advance: open operator modal after refresh
					const targetFilter = (isPlaceholder
						? parentGroup.conditions[parentGroup.conditions.length - 1]
						: filter) as Filter;
					this.pendingAutoOpen = { filter: targetFilter, action: "operator" };

					this.onSave();
					this.onRefresh();
				},
				propertyBtn
			);
		};

		setupComboboxButtonHandlers(propertyBtn, statement, openPropertyModal);

		const validOps = getOperatorsForField(filter.field, currentType) as FilterOperator[];

		const operatorBtn = createComboboxButton(expression, filter.operator);

		const openOperatorModal = () => {
			addFocusClasses(operatorBtn, expression);
			this.openCombobox(
				validOps.map(op => ({ label: op, value: op })),
				filter.operator,
				(newVal) => {
					const operator = newVal as FilterOperator;
					// If this is a placeholder, add it to the conditions array first
					if (isPlaceholder && !placeholderAdded) {
						parentGroup.conditions.push({ ...filter, operator });
						placeholderAdded = true;
					} else if (isPlaceholder && placeholderAdded) {
						// Update the filter in the conditions array (it's the last one we added)
						const conditionIndex = parentGroup.conditions.length - 1;
						if (conditionIndex >= 0 && parentGroup.conditions[conditionIndex].type === "filter") {
							parentGroup.conditions[conditionIndex].operator = operator;
						}
					} else {
						filter.operator = operator;
					}

					// Auto-advance: focus value input after refresh (if operator takes a value)
					if (!["is empty", "is not empty"].includes(operator)) {
						const targetFilter = (isPlaceholder && placeholderAdded
							? parentGroup.conditions[parentGroup.conditions.length - 1]
							: filter) as Filter;
						this.pendingAutoOpen = { filter: targetFilter, action: "value" };
					}

					this.onSave();
					this.onRefresh();
				},
				operatorBtn
			);
		};

		setupComboboxButtonHandlers(operatorBtn, statement, openOperatorModal);

		// Auto-advance: open operator modal if pending
		if (this.pendingAutoOpen?.filter === filter && this.pendingAutoOpen.action === "operator") {
			this.pendingAutoOpen = null;
			// Add focus class immediately to prevent flicker between combobox transitions
			addFocusClasses(operatorBtn, expression);
			window.setTimeout(() => openOperatorModal(), 50);
		}

		const handleDelete = () => {
			if (isPlaceholder) {
				// For placeholder, just refresh to show the default again
				this.onRefresh();
			} else {
				parentGroup.conditions.splice(index, 1);
				this.onSave();
				this.onRefresh();
			}
		};

		if (!["is empty", "is not empty"].includes(filter.operator)) {
			const rhs = expression.createDiv({ cls: "cv-filter-rhs-container metadata-property-value" });

			createFilterValueInput(rhs, currentType, filter.value, (val) => {
				// If this is a placeholder, add it to the conditions array first
				if (isPlaceholder && !placeholderAdded) {
					parentGroup.conditions.push({ ...filter, value: val });
					placeholderAdded = true;
				} else if (isPlaceholder && placeholderAdded) {
					// Update the filter in the conditions array (it's the last one we added)
					const conditionIndex = parentGroup.conditions.length - 1;
					if (conditionIndex >= 0 && parentGroup.conditions[conditionIndex].type === "filter") {
						parentGroup.conditions[conditionIndex].value = val;
					}
				} else {
					filter.value = val;
				}

				this.onSave();
			}, filter.operator, this.plugin.app, filter.field);

			// Auto-advance: focus value input if pending
			if (this.pendingAutoOpen?.filter === filter && this.pendingAutoOpen.action === "value") {
				this.pendingAutoOpen = null;
				window.setTimeout(() => {
					const focusTarget = rhs.querySelector("input, .cv-multi-select-input") as HTMLElement;
					if (focusTarget) focusTarget.focus();
				}, 50);
			}
		}


		const actions = expression.createDiv({ cls: "cv-filter-row-actions" });
		createDeleteButton(actions, handleDelete);
	}


	openCombobox(
		items: ComboboxItem[],
		selectedValue: string,
		onSelect: (val: string) => void,
		anchorEl?: HTMLElement
	) {
		new ComboboxSuggestModal(this.plugin.app, items, selectedValue, onSelect, anchorEl).open();
	}

	createSimpleBtn(container: HTMLElement, icon: string, text: string, onClick: () => void) {
		const btn = container.createDiv({ cls: "cv-text-icon-button", attr: { tabindex: "0" } });
		setIcon(btn.createSpan({ cls: "cv-text-button-icon" }), icon);
		btn.createSpan({ cls: "cv-text-button-label", text: text });
		btn.onclick = (e) => { e.stopPropagation(); onClick(); };
	}
}
