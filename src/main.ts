import { Plugin, TFile, MarkdownView, Keymap, Notice, WorkspaceLeaf } from "obsidian";
import { Compartment, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CustomViewsSettings, DEFAULT_SETTINGS, CustomViewsSettingTab } from "./settings";
import { checkRules } from "./matcher";
import { renderTemplate, templateHasEditableContent, EDITABLE_PLACEHOLDER_ATTR } from "./renderer";
import { createEditableContentExtensions } from "./editable-content";
import type { ViewConfig } from "./types";

const CUSTOM_VIEW_CLASS = "obsidian-custom-view-render";
const HIDE_MARKDOWN_CLASS = "obsidian-custom-view-hidden";
const EDITABLE_MODE_CLASS = "obsidian-custom-view-editable";

/**
 * Interface for canvas node structure
 * CanvasView and CanvasNode types are not exported from Obsidian, so we define minimal interfaces
 */
interface CanvasNode {
	file?: TFile;
	nodeEl?: HTMLElement;
}

/**
 * Interface for canvas structure
 * CanvasView type is not exported from Obsidian, so we define a minimal interface
 */
interface CanvasView {
	canvas?: {
		nodes?: CanvasNode[];
	};
}

/**
 * Type guard to check if a view is a canvas view
 */
function isCanvasView(view: unknown): view is CanvasView {
	return typeof view === "object" && view !== null && "canvas" in view;
}

/**
 * Safely gets the CM6 EditorView from a MarkdownView.
 * Uses the widely-used (view.editor as any).cm pattern.
 * Returns null if not available.
 */
function getCM6EditorView(view: MarkdownView): EditorView | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
		const cm = (view.editor as any).cm;
		if (cm instanceof EditorView) return cm;
	} catch {
		// Fallback: try finding from DOM
	}
	const cmDom = view.contentEl.querySelector(".cm-editor");
	if (cmDom) return EditorView.findFromDOM(cmDom as HTMLElement) ?? null;
	return null;
}

/** Tracks the editable content state for a single view */
interface EditableState {
	/** The original parent of the editor element, for restoration */
	originalParent: HTMLElement;
	/** The original next sibling, to restore position precisely */
	originalNextSibling: Node | null;
	/** The editor DOM element that was moved */
	editorEl: HTMLElement;
	/** The CM6 EditorView reference */
	cmView: EditorView;
}

/**
 * Manages a single CM6 Compartment per EditorView.
 * Ensures appendConfig is only called once, and subsequent inject/restore
 * calls just reconfigure the same compartment.
 */
interface CompartmentEntry {
	compartment: Compartment;
	appended: boolean;
}

export default class CustomViewsPlugin extends Plugin {
	settings: CustomViewsSettings;

	/**
	 * Tracks editable state per MarkdownView content element.
	 * Keyed by the contentEl reference (unique per leaf).
	 */
	private editableStates: WeakMap<HTMLElement, EditableState> = new WeakMap();

	/**
	 * One compartment per CM6 EditorView, reused across inject/restore cycles.
	 * Prevents compartment accumulation from repeated appendConfig calls.
	 */
	private compartments: WeakMap<EditorView, CompartmentEntry> = new WeakMap();

	/** Guard against concurrent processActiveView calls */
	private processing = false;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CustomViewsSettingTab(this.app, this));

		this.addCommand({
			id: "enable",
			name: "Enable",
			checkCallback: (checking) => {
				if (checking) {
					return !this.settings.enabled;
				}

				void this.setPluginState(true);
				return true;
			},
		});

		this.addCommand({
			id: "disable",
			name: "Disable",
			checkCallback: (checking) => {
				if (checking) {
					return this.settings.enabled;
				}

				void this.setPluginState(false);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => this.processActiveView(file))
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				const file = this.app.workspace.getActiveFile();

				void this.processActiveView(file);
				if (this.settings.workInCanvas) {
					void this.processAllCanvasNodes();
				}
			})
		);

		// Process canvas nodes when canvas changes
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (this.settings.workInCanvas) {
					void this.processAllCanvasNodes();
				}
			})
		);

		// Also process canvas nodes periodically to catch updates
		this.registerInterval(window.setInterval(() => {
			if (this.settings.enabled && this.settings.workInCanvas) {
				void this.processAllCanvasNodes();
			}
		}, 1000));
	}

	async setPluginState(enabled: boolean) {
		this.settings.enabled = enabled;
		await this.saveSettings();

		new Notice(enabled ? "Custom Views Enabled" : "Custom Views Disabled");

		const file = this.app.workspace.getActiveFile();

		if (file) {
			void this.processActiveView(file);
		}
	}

	onunload() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				this.restoreEditableView(leaf.view);
				this.restoreDefaultView(leaf.view);
			}
		});
		// Clean up canvas nodes
		this.restoreAllCanvasNodes();
	}

	async processActiveView(file: TFile | null) {
		if (!file) return;

		// Guard against concurrent calls (file-open + layout-change can fire together)
		if (this.processing) return;
		this.processing = true;

		// Capture focused element before any DOM manipulation so keyboard
		// navigation (e.g. cmd+up/down in the file explorer) isn't interrupted.
		const previouslyFocused = activeDocument.activeElement as HTMLElement | null;

		try {
			await this._processActiveView(file);
		} finally {
			this.processing = false;

			// Restore focus after all DOM manipulation completes.
			// Use requestAnimationFrame so the restore runs after any pending
			// layout passes triggered by requestMeasure() or MarkdownRenderer.
			if (previouslyFocused) {
				const activeView = this.app.workspace.getLeaf(false)?.view;
				const viewContentEl = activeView instanceof MarkdownView ? activeView.contentEl : null;
				window.requestAnimationFrame(() => {
					if (
						previouslyFocused !== activeDocument.activeElement &&
						activeDocument.contains(previouslyFocused) &&
						(!viewContentEl || !viewContentEl.contains(previouslyFocused))
					) {
						previouslyFocused.focus();
					}
				});
			}
		}
	}

	private async _processActiveView(file: TFile) {
		const leaf = this.app.workspace.getLeaf(false);
		if (!(leaf.view instanceof MarkdownView)) return;

		const view = leaf.view;

		// Always clean up editable state first — before any mode/template checks.
		// This ensures the editor is back in its original position before we decide
		// what to do next.
		this.restoreEditableView(view);

		if (!this.settings.enabled) {
			this.restoreDefaultView(view);
			return;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		let matchedConfig: ViewConfig | null = null;

		for (const viewConfig of this.settings.views) {
			const isMatch = checkRules(this.app, viewConfig.rules, file, cache?.frontmatter);
			if (isMatch) {
				matchedConfig = viewConfig;
				break;
			}
		}

		if (!matchedConfig) {
			this.restoreDefaultView(view);
			return;
		}

		const matchedTemplate = matchedConfig.template;

		const state = view.getState();
		const isTrueSourceMode = state.mode === 'source' && state.source === true;
		const isReadingMode = state.mode === 'preview';
		const isLivePreviewMode = state.mode === 'source' && state.source === false;

		if (isTrueSourceMode) {
			this.restoreDefaultView(view);
			return;
		}

		if (!this.settings.workInLivePreview && !isReadingMode) {
			this.restoreDefaultView(view);
			return;
		} else if (!isReadingMode && !isLivePreviewMode) {
			this.restoreDefaultView(view);
			return;
		}

		// Check if we should use editable mode
		const canUseEditableMode =
			this.settings.editableContent &&
			this.settings.workInLivePreview &&
			isLivePreviewMode &&
			templateHasEditableContent(matchedTemplate);

		if (canUseEditableMode) {
			// Clean up any existing read-only overlay first
			this.restoreDefaultView(view);
			await this.injectEditableView(view, file, matchedConfig);
		} else {
			await this.injectCustomView(view.contentEl, file, matchedTemplate, matchedConfig);
		}
	}

	// ─── Read-only Overlay (existing behavior) ─────────────────────────────────

	async injectCustomView(container: HTMLElement, file: TFile, template: string, viewConfig?: ViewConfig) {
		let customEl = container.querySelector(`.${CUSTOM_VIEW_CLASS}`) as HTMLElement;

		if (!customEl) {
			customEl = activeDocument.createElement("div");
			customEl.addClass(CUSTOM_VIEW_CLASS);
			container.appendChild(customEl);

			this.registerDomEvent(customEl, "click", (evt: MouseEvent) => {
				const target = evt.target as HTMLElement;
				const link = target.closest(".internal-link");

				if (link && link.instanceOf(HTMLAnchorElement)) {
					evt.preventDefault();
					const href = link.getAttribute("data-href") || link.getAttribute("href");

					if (href) {
						const newLeaf = Keymap.isModEvent(evt);
						void this.app.workspace.openLinkText(href, file.path, newLeaf);
					}
				}
			});
		}

		await renderTemplate(this.app, template, file, customEl, this);

		// Apply per-view display options
		this.applyViewDisplayOptions(container, viewConfig);

		container.addClass(HIDE_MARKDOWN_CLASS);
	}

	restoreDefaultView(view: MarkdownView) {
		const container = view.contentEl;
		container.removeClass(HIDE_MARKDOWN_CLASS);
		container.removeClass(EDITABLE_MODE_CLASS);
		container.removeAttribute("data-cv-hide-properties");
		container.removeAttribute("data-cv-hide-inline-title");
		const customEl = container.querySelector(`.${CUSTOM_VIEW_CLASS}`);
		if (customEl) customEl.remove();
	}

	// ─── Editable Content Mode ─────────────────────────────────────────────────

	/**
	 * Gets or creates a Compartment for the given EditorView.
	 * Only calls appendConfig once per EditorView lifetime.
	 */
	private getOrCreateCompartment(cmView: EditorView): Compartment {
		let entry = this.compartments.get(cmView);
		if (!entry) {
			entry = { compartment: new Compartment(), appended: false };
			this.compartments.set(cmView, entry);
		}
		if (!entry.appended) {
			cmView.dispatch({
				effects: StateEffect.appendConfig.of(entry.compartment.of([]))
			});
			entry.appended = true;
		}
		return entry.compartment;
	}

	private async injectEditableView(view: MarkdownView, file: TFile, viewConfig: ViewConfig) {
		const container = view.contentEl;
		const template = viewConfig.template;

		// Get the CM6 editor view
		const cmView = getCM6EditorView(view);
		if (!cmView) {
			// Fallback: if we can't access CM6, use the read-only overlay
			console.warn("[Custom Views] Could not access CM6 EditorView, falling back to read-only mode.");
			await this.injectCustomView(container, file, template, viewConfig);
			return;
		}

		// Find the editor element (.markdown-source-view)
		const editorEl = container.querySelector(".markdown-source-view") as HTMLElement;
		if (!editorEl) {
			await this.injectCustomView(container, file, template, viewConfig);
			return;
		}

		// Create the overlay element
		let customEl = container.querySelector(`.${CUSTOM_VIEW_CLASS}`) as HTMLElement;
		if (!customEl) {
			customEl = activeDocument.createElement("div");
			customEl.addClass(CUSTOM_VIEW_CLASS);
			container.appendChild(customEl);
		}

		// Render template with editableMode=true (content placeholder left empty)
		await renderTemplate(this.app, template, file, customEl, this, true);

		// Find the content placeholder
		const placeholder = customEl.querySelector(`[${EDITABLE_PLACEHOLDER_ATTR}]`) as HTMLElement;
		if (!placeholder) {
			// Template has no content placeholder? Fall back to read-only.
			container.addClass(HIDE_MARKDOWN_CLASS);
			return;
		}

		// Register click handler for internal links in the template chrome
		// (not inside the editor — let the editor handle its own clicks)
		this.registerDomEvent(customEl, "click", (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;

			// Don't intercept clicks inside the editor
			if (editorEl.contains(target)) return;

			const link = target.closest(".internal-link");
			if (link && link.instanceOf(HTMLAnchorElement)) {
				evt.preventDefault();
				const href = link.getAttribute("data-href") || link.getAttribute("href");
				if (href) {
					const newLeaf = Keymap.isModEvent(evt);
					void this.app.workspace.openLinkText(href, file.path, newLeaf);
				}
			}
		});

		// Save state for restoration
		const originalParent = editorEl.parentElement!;
		const originalNextSibling = editorEl.nextSibling;

		// Get or create a compartment for this editor (reused across navigations)
		const compartment = this.getOrCreateCompartment(cmView);

		// Configure with our extensions
		cmView.dispatch({
			effects: compartment.reconfigure(createEditableContentExtensions())
		});

		// Reparent the editor into the placeholder
		placeholder.appendChild(editorEl);

		// Tell CM6 to recalculate its layout in the new position
		cmView.requestMeasure();

		// Mark the container and apply per-view display options
		container.addClass(EDITABLE_MODE_CLASS);
		this.applyViewDisplayOptions(container, viewConfig);

		// Store state for cleanup
		this.editableStates.set(container, {
			originalParent,
			originalNextSibling,
			editorEl,
			cmView,
		});
	}

	private restoreEditableView(view: MarkdownView) {
		const container = view.contentEl;
		const state = this.editableStates.get(container);
		if (!state) return;

		// Remove our CM6 extensions (reconfigure compartment to empty)
		try {
			const entry = this.compartments.get(state.cmView);
			if (entry) {
				state.cmView.dispatch({
					effects: entry.compartment.reconfigure([])
				});
			}
		} catch {
			// Editor may have been destroyed already
		}

		// Move the editor back to its original position
		if (state.originalNextSibling && state.originalParent.contains(state.originalNextSibling)) {
			state.originalParent.insertBefore(state.editorEl, state.originalNextSibling);
		} else {
			state.originalParent.appendChild(state.editorEl);
		}

		// Recalculate layout in original position
		try {
			state.cmView.requestMeasure();
		} catch {
			// Editor may have been destroyed
		}

		// Remove editable mode class, display options, and overlay
		container.removeClass(EDITABLE_MODE_CLASS);
		container.removeAttribute("data-cv-hide-properties");
		container.removeAttribute("data-cv-hide-inline-title");
		const customEl = container.querySelector(`.${CUSTOM_VIEW_CLASS}`);
		if (customEl) customEl.remove();

		// Clean up state
		this.editableStates.delete(container);
	}

	// ─── Per-view Display Options ──────────────────────────────────────────────

	/**
	 * Applies per-view display options (show/hide properties and inline title)
	 * via data attributes on the container element.
	 */
	private applyViewDisplayOptions(container: HTMLElement, viewConfig?: ViewConfig) {
		if (!viewConfig) return;

		// showProperties defaults to true if not set
		if (viewConfig.showProperties === false) {
			container.setAttribute("data-cv-hide-properties", "true");
		} else {
			container.removeAttribute("data-cv-hide-properties");
		}

		// showInlineTitle defaults to true if not set
		if (viewConfig.showInlineTitle === false) {
			container.setAttribute("data-cv-hide-inline-title", "true");
		} else {
			container.removeAttribute("data-cv-hide-inline-title");
		}
	}

	// ─── Settings ──────────────────────────────────────────────────────────────

	async loadSettings() {
		const loadedData = await this.loadData() as Partial<CustomViewsSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ─── Canvas Support ────────────────────────────────────────────────────────

	/**
	 * Process all markdown file nodes in canvas files
	 */
	processAllCanvasNodes() {
		if (!this.settings.enabled || !this.settings.workInCanvas) {
			this.restoreAllCanvasNodes();
			return;
		}

		// Find all canvas views
		this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			const view = leaf.view;
			// Check if this is a canvas view (CanvasView type may not be exported, so we check by class)
			if (isCanvasView(view) && view.canvas) {
				const canvas = view.canvas;
				if (canvas.nodes) {
					// Process each node in the canvas
					canvas.nodes.forEach((node) => {
						if (node.file && node.file instanceof TFile && node.file.extension === "md") {
							void this.processCanvasNode(node);
						}
					});
				}
			}
		});
	}

	/**
	 * Process a single canvas node
	 */
	async processCanvasNode(node: CanvasNode) {
		const file = node.file;
		if (!(file instanceof TFile)) return;

		const cache = this.app.metadataCache.getFileCache(file);
		let matchedTemplate = "";

		for (const viewConfig of this.settings.views) {
			const isMatch = checkRules(this.app, viewConfig.rules, file, cache?.frontmatter);
			if (isMatch) {
				matchedTemplate = viewConfig.template;
				break;
			}
		}

		if (!matchedTemplate) {
			this.restoreCanvasNode(node);
			return;
		}

		// Find the node's content element
		const nodeEl = node.nodeEl as HTMLElement;
		if (!nodeEl) return;

		// Find the markdown preview container within the node
		const previewContainer = nodeEl.querySelector(".markdown-preview-view") as HTMLElement;
		if (!previewContainer) return;

		await this.injectCustomView(previewContainer, file, matchedTemplate);
	}

	/**
	 * Restore a canvas node to default view
	 */
	restoreCanvasNode(node: CanvasNode) {
		const nodeEl = node.nodeEl as HTMLElement;
		if (!nodeEl) return;

		const previewContainer = nodeEl.querySelector(".markdown-preview-view") as HTMLElement;
		if (!previewContainer) return;

		previewContainer.removeClass(HIDE_MARKDOWN_CLASS);
		const customEl = previewContainer.querySelector(`.${CUSTOM_VIEW_CLASS}`);
		if (customEl) customEl.remove();
	}

	/**
	 * Restore all canvas nodes
	 */
	restoreAllCanvasNodes() {
		this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			const view = leaf.view;
			if (isCanvasView(view) && view.canvas) {
				const canvas = view.canvas;
				if (canvas.nodes) {
					canvas.nodes.forEach((node) => {
						this.restoreCanvasNode(node);
					});
				}
			}
		});
	}

}
