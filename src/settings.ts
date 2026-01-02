import { App, PluginSettingTab, Setting, ButtonComponent, TextComponent, setIcon, Modal, FuzzySuggestModal, FuzzyMatch } from "obsidian";
import CustomViewsPlugin from "./main";
import { ViewConfig, FilterGroup, Filter, FilterOperator, FilterConjunction } from "./types";


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

const OPERATORS: Record<string, string[]> = {
	text: ["contains", "does not contain", "is", "is not", "starts with", "ends with", "contains any of", "does not contain any of", "contains all of", "does not contain all of", "is empty", "is not empty"],
	list: ["contains", "does not contain", "contains any of", "does not contain any of", "contains all of", "does not contain all of", "is empty", "is not empty"],
	number: ["=", "≠", "<", "≤", ">", "≥", "is empty", "is not empty"],
	date: ["on", "not on", "before", "on or before", "after", "on or after", "is empty", "is not empty"],
	checkbox: ["is"],
	file: ["links to", "does not link to", "in folder", "is not in folder", "has tag", "does not have tag", "has property", "does not have property"]
};

const DEFAULT_RULES: FilterGroup = {
	type: "group",
	operator: "AND",
	conditions: []
};


export interface CustomViewsSettings {
	enabled: boolean;
	workInLivePreview: boolean;
	workInCanvas: boolean;
	views: ViewConfig[];
}

export const DEFAULT_SETTINGS: CustomViewsSettings = {
	enabled: true,
	workInLivePreview: true,
	workInCanvas: false,
	views: [
		{
			id: 'default-1',
			name: 'View 1',
			rules: JSON.parse(JSON.stringify(DEFAULT_RULES)) as FilterGroup,
			template: "<h1>{{file.basename}}</h1> <p>{{file.content}}</p>"
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
					const file = this.app.workspace.getActiveFile();
					if (file) {
						this.plugin.processActiveView(file).catch(() => {
							// Error handling for processActiveView
						});
					}
				}));

		new Setting(containerEl)
			.setName("Work in canvas (experimental)")
			// .setDesc("Enable to apply custom views to markdown file nodes in canvas files.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.workInCanvas)
				.onChange(async (value) => {
					this.plugin.settings.workInCanvas = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.processAllCanvasNodes();
					} else {
						this.plugin.restoreAllCanvasNodes();
					}
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
						template: "<h1>{{file.basename}}</h1>"
					};
					this.plugin.settings.views.push(newView);
					await this.plugin.saveSettings();
					this.display();

					const newIndex = this.plugin.settings.views.length - 1;
					new EditViewModal(this.app, this.plugin, newView, newIndex, () => {
						this.display();
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
	onSave: () => void;
	private nameTextComponent: TextComponent | null = null;

	constructor(app: App, plugin: CustomViewsPlugin, view: ViewConfig, viewIndex: number, onSave: () => void) {
		super(app);
		this.plugin = plugin;
		this.view = JSON.parse(JSON.stringify(view)) as ViewConfig;
		this.viewIndex = viewIndex;
		this.onSave = onSave;
		this.setTitle('Edit view');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("cv-edit-view-modal");


		new Setting(contentEl)
			.setName("View name")
			.setDesc("The name of the view will be displayed in the view selector.")
			.addText(text => {
				this.nameTextComponent = text;
				text.setValue(this.view.name)
					.onChange((value) => {
						this.view.name = value;
					});
				requestAnimationFrame(() => {
					text.inputEl.select();
				});
			});

		contentEl.createEl("h3", { text: "Rules" });
		const rulesContainer = contentEl.createDiv({ cls: "cv-bases-query-container" });

		const builder = new FilterBuilder(
			this.plugin,
			this.view.rules,
			() => { void this.plugin.saveSettings(); },
			() => { rulesContainer.empty(); builder.render(rulesContainer); }
		);
		builder.render(rulesContainer);

		contentEl.createEl("h3", { text: "HTML template" });
		const templateContainer = contentEl.createDiv({ cls: "cv-bases-template-container" });
		const textarea = templateContainer.createEl("textarea", {
			cls: "cv-textarea",
			text: this.view.template
		});
		textarea.addEventListener("input", (e: Event) => {
			const target = e.target as HTMLTextAreaElement;
			this.view.template = target.value;
		});

		const buttonContainer = contentEl.createDiv('modal-button-container');



		new ButtonComponent(buttonContainer)
			.setButtonText("Save")
			.setCta()
			.onClick(async () => {
				this.plugin.settings.views[this.viewIndex] = this.view;
				await this.plugin.saveSettings();
				this.onSave();
				this.close();
			});

		new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(() => {
				this.close();
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

interface PropertyDef {
	key: string;
	type: PropertyType;
}

interface SuggestItem {
	label: string;
	value: string;
	icon?: string;
}

/**
 * Unified combobox modal for property and operator selection.
 * Consolidates PropertySuggestModal and OperatorSuggestModal into a single reusable class.
 */
class ComboboxSuggestModal extends FuzzySuggestModal<SuggestItem> {
	private items: SuggestItem[];
	private selectedValue: string;
	private onSelect: (val: string) => void;
	private anchorEl: HTMLElement | null = null;
	private clickOutsideHandler: ((evt: MouseEvent) => void) | null = null;

	constructor(
		app: App,
		items: SuggestItem[],
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

	getItems(): SuggestItem[] {
		return this.items;
	}

	getItemText(item: SuggestItem): string {
		return item.label;
	}

	onOpen() {
		void super.onOpen();

		// Style modal as combobox
		requestAnimationFrame(() => {
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
				requestAnimationFrame(() => {
					updateClearButtonVisibility();
				});

				// Update on input change
				input.addEventListener('input', updateClearButtonVisibility);
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
			requestAnimationFrame(() => {
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

		setTimeout(() => {
			document.addEventListener('mousedown', this.clickOutsideHandler!);
		}, 0);
	}

	renderSuggestion(match: FuzzyMatch<SuggestItem>, el: HTMLElement): void {
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

	onChooseItem(item: SuggestItem): void {
		this.onSelect(item.value);
	}

	onClose() {
		if (this.clickOutsideHandler) {
			document.removeEventListener('mousedown', this.clickOutsideHandler);
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
	onClick: (e: MouseEvent) => void,
	additionalClasses: string = ""
): HTMLElement {
	const deleteBtn = container.createEl("button", {
		cls: `clickable-icon ${additionalClasses}`.trim(),
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
	operator?: string
): HTMLInputElement | HTMLElement {
	const safeValue = value || "";
	const needsMultiSelect = operator === "contains any of" || operator === "does not contain any of"
		|| operator === "contains all of" || operator === "does not contain all of"
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
					setTimeout(() => focusInput(), 0);
				}
			} else if (e.key === "Backspace") {
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
							setTimeout(() => focusPill(newIndex), 0);
						} else {
							setTimeout(() => focusInput(), 0);
						}
					}
				} else if (e.key === "Tab" && !e.shiftKey) {
					e.preventDefault();
					const pills = getPills();
					// Focus next pill or input if last pill
					if (currentIndex < pills.length - 1) {
						focusPill(currentIndex + 1);
					} else {
						focusInput();
					}
				} else if (e.key === "Tab" && e.shiftKey) {
					e.preventDefault();
					// Focus previous pill or input if first pill
					if (currentIndex > 0) {
						focusPill(currentIndex - 1);
					} else {
						focusInput();
					}
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
							setTimeout(() => focusPill(newIndex), 0);
						} else {
							setTimeout(() => focusInput(), 0);
						}
					}
				}, (pill: HTMLElement) => {
					setupPillNavigation(pill);
				});
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
		const input = container.createEl("input", { type: "text", value: safeValue });
		input.addClass("metadata-input", "metadata-input-text");
		input.placeholder = "Value...";
		input.oninput = () => onChange(input.value);
		return input;
	}
}

function createPill(container: HTMLElement, value: string, onRemove: () => void, onCreated?: (pill: HTMLElement) => void): void {
	const pill = container.createDiv({ cls: "multi-select-pill", attr: { tabindex: "0" } });
	pill.createDiv({ cls: "multi-select-pill-content", text: value });
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
		if (e.key === " " || e.key === "Spacebar") {
			e.preventDefault();
			e.stopPropagation();
			onOpen();
		}
	};
}

class FilterBuilder {
	plugin: CustomViewsPlugin;
	root: FilterGroup;
	onSave: () => void;
	onRefresh: () => void;
	onDeleteView?: () => void;
	availableProperties: PropertyDef[];

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
			"file.mtime": "modified time"
		};
		return labelMap[key] || key;
	}

	/**
	 * Gets the icon for a property
	 */
	getPropertyIcon(key: string, type: PropertyType): string {
		if (key === "file tags") return "tags";
		if (key === "aliases") return "forward";
		if (key === "file.ctime" || key === "file.mtime") return "clock";
		return TYPE_ICONS[type] || "pilcrow";
	}

	/**
	 * Scans the vault to find properties and INFER their types.
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
					const val = cache.frontmatter[key] as string | number | boolean | string[] | undefined;
					const type = this.inferType(val);
					propMap.set(key, type);
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
			this.openPropertySuggestModal(
				this.availableProperties.map(p => ({
					label: this.getPropertyLabel(p.key),
					value: p.key,
					icon: this.getPropertyIcon(p.key, p.type)
				})),
				filter.field,
				(newVal) => {
					const newType = this.getPropertyType(newVal);
					const validOps = OPERATORS[newType === "datetime" ? "date" : newType] || OPERATORS["text"];
					const newOperator = validOps[0] as FilterOperator;

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

					this.onSave();
					this.onRefresh();
				},
				propertyBtn
			);
		};

		setupComboboxButtonHandlers(propertyBtn, statement, openPropertyModal);

		let opsKey = currentType;
		if (currentType === "datetime") opsKey = "date";
		if (currentType === "unknown") opsKey = "text";
		if (!OPERATORS[opsKey]) opsKey = "text";

		const validOps = OPERATORS[opsKey] as FilterOperator[];

		const operatorBtn = createComboboxButton(expression, filter.operator);

		const openOperatorModal = () => {
			addFocusClasses(operatorBtn, expression);
			this.openOperatorSuggestModal(
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

					this.onSave();
					this.onRefresh();
				},
				operatorBtn
			);
		};

		setupComboboxButtonHandlers(operatorBtn, statement, openOperatorModal);

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
			}, filter.operator);
		}

		const actions = expression.createDiv({ cls: "cv-filter-row-actions" });
		createDeleteButton(actions, handleDelete);
	}


	openPropertySuggestModal(
		items: { label: string, value: string, icon?: string }[],
		selectedValue: string,
		onSelect: (val: string) => void,
		anchorEl?: HTMLElement
	) {
		const modal = new ComboboxSuggestModal(this.plugin.app, items, selectedValue, onSelect, anchorEl);
		modal.open();
	}

	openOperatorSuggestModal(
		items: { label: string, value: string }[],
		selectedValue: string,
		onSelect: (val: string) => void,
		anchorEl?: HTMLElement
	) {
		const modal = new ComboboxSuggestModal(
			this.plugin.app,
			items,
			selectedValue,
			onSelect,
			anchorEl
		);
		modal.open();
	}

	createSimpleBtn(container: HTMLElement, icon: string, text: string, onClick: () => void) {
		const btn = container.createDiv({ cls: "cv-text-icon-button", attr: { tabindex: "0" } });
		setIcon(btn.createSpan({ cls: "cv-text-button-icon" }), icon);
		btn.createSpan({ cls: "cv-text-button-label", text: text });
		btn.onclick = (e) => { e.stopPropagation(); onClick(); };
	}
}
