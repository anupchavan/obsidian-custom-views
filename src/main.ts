import { RenderCoordinator } from "./render-coordinator";
import { SettingsWriter } from "./settings-writer";
import { Plugin, TFile, MarkdownView, Keymap, Menu, Notice, WorkspaceLeaf } from "obsidian";
import { Compartment, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CustomViewsSettings, DEFAULT_SETTINGS, CustomViewsSettingTab } from "./settings";
import { NativeRuleEngine } from "./native-filters/engine";
import { renderTemplate, templateHasEditableContent, EDITABLE_PLACEHOLDER_ATTR } from "./renderer";
import { createEditableContentExtensions } from "./editable-content";
import { warmCustomViewScriptEngine } from "./script-engine";
import type { ViewConfig } from "./types";
import { EmbeddedBasesProvider } from "./bases/provider";

const CUSTOM_VIEW_CLASS = "obsidian-custom-view-render";
const HIDE_MARKDOWN_CLASS = "obsidian-custom-view-hidden";
const EDITABLE_MODE_CLASS = "obsidian-custom-view-editable";
const PENDING_VIEW_CLASS = "obsidian-custom-view-pending";

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
 * Uses the widely-used `view.editor.cm` pattern (not in the public typings).
 * Returns null if not available.
 */
function getCM6EditorView(view: MarkdownView): EditorView | null {
	try {
		const cm = (view.editor as { cm?: EditorView }).cm;
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
	nativeRules: NativeRuleEngine;
	private settingsWriter = new SettingsWriter<CustomViewsSettings>(settings => this.saveData(settings));

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

	private renders = new RenderCoordinator<MarkdownView>();

	/** Bumped on settings save to invalidate stateKey cache */
	private settingsVersion = 0;

	/** Counter for generating unique per-container scope IDs */
	private nextScopeId = 0;

	/** One delegated pair of link listeners per leaf, not per rendered note. */
	private overlayLinkHosts = new WeakSet<HTMLElement>();

	/** Provides Obsidian Bases query results to templates when Bases are referenced. */
	private basesProvider: EmbeddedBasesProvider | undefined;

	/** Prevents deferred startup work from running after a fast disable/reload. */
	private unloaded = false;
	private noteRefreshTimers = new Map<TFile, number>();
	private contentVersions = new WeakMap<MarkdownView, number>();
	private renderedMetadata = new WeakMap<MarkdownView, { path: string; value: string }>();

	/** Refresh saved content without rebuilding the live editor for each keystroke. */
	private queueNoteRefresh(file: TFile): void {
		if (this.unloaded) return;
		const previous = this.noteRefreshTimers.get(file);
		if (previous !== undefined) window.clearTimeout(previous);
		this.noteRefreshTimers.set(file, window.setTimeout(() => {
			this.noteRefreshTimers.delete(file);
			if (this.unloaded) return;
			const metadata = JSON.stringify(this.app.metadataCache.getFileCache(file)?.frontmatter ?? {});
			this.app.workspace.iterateAllLeaves(leaf => {
				if (!(leaf.view instanceof MarkdownView) || leaf.view.file !== file) return;
				const view = leaf.view;
				const rendered = this.renderedMetadata.get(view);
				const state = view.getState();
				if (state.mode === "source" && state.source === false &&
					this.editableStates.has(view.contentEl) &&
					rendered?.path === file.path && rendered.value === metadata) return;
				this.contentVersions.set(view, (this.contentVersions.get(view) ?? 0) + 1);
				this.clearAppliedState(view.contentEl);
				void this._processLeaf(view, file);
			});
		}, 150));
	}

	async onload() {
		this.unloaded = false;
		await this.loadSettings();
		this.nativeRules = new NativeRuleEngine(this.app, () => {
			if (!this.unloaded) this.refreshAllViews();
		});
		try { await this.nativeRules.prepare(); } catch (error) {
			if (this.settings.views.some(view => view.basesFilters != null)) {
				new Notice(error instanceof Error ? error.message : "Native view filters are unavailable.");
			}
		}
		this.prepareScriptEngine();
		this.basesProvider = new EmbeddedBasesProvider(this);
		this.basesProvider.register();
		this.addSettingTab(new CustomViewsSettingTab(this.app, this));
		this.registerEvent(this.app.metadataCache.on("changed", file => this.queueNoteRefresh(file)));
		this.app.workspace.onLayoutReady(() => {
			window.setTimeout(() => {
				if (!this.unloaded) {
					this.refreshAllViews();
				}
			}, 0);
		});

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
			this.app.workspace.on("file-open", (file) => {

				if (file) {
					this.hideStaleActiveOverlay(file);
					this.preHideIfMatch(file);
					void this.processActiveView(file);
				}
				window.setTimeout(() => {
					void this.processActiveView(file);
				}, 0);
			})
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				const file = this.app.workspace.getActiveFile();
				if (file) {
					this.hideStaleActiveOverlay(file);
				}
				window.setTimeout(() => {
					void this.processActiveView(file);
					if (this.settings.workInCanvas) {
						void this.processAllCanvasNodes();
					}
				}, 0);
			})
		);

		// Process canvas nodes and markdown views when active leaf changes
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (this.settings.workInCanvas) {
					void this.processAllCanvasNodes();
				}
				if (leaf && leaf.view instanceof MarkdownView && leaf.view.file) {
					const file = leaf.view.file;
					this.hideStaleOverlay(leaf.view, file);
					this.preHideIfMatch(file);
					void this.processActiveView(file);
					window.setTimeout(() => {
						void this.processActiveView(file);
					}, 0);
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
		this.refreshAllViews();
	}

	onunload() {
		this.unloaded = true;
		for (const timer of this.noteRefreshTimers.values()) window.clearTimeout(timer);
		this.noteRefreshTimers.clear();
		this.renders.cancelAll();
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				this.restoreEditableView(leaf.view);
				this.restoreDefaultView(leaf.view);
			}
		});
		// Clean up canvas nodes
		this.restoreAllCanvasNodes();
	}

	private prepareScriptEngine() {
		if (!this.settings.allowJavaScript) return;

		void warmCustomViewScriptEngine().catch((e) => {
			console.error("[Custom Views] Failed to initialize script engine:", e);
		});
	}

	private hideStaleActiveOverlay(file: TFile) {
		if (!this.settings.enabled) return;

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			this.hideStaleOverlay(activeView, file);
		}
	}

	private hideStaleOverlay(view: MarkdownView, file: TFile) {
		const container = view.contentEl;
		const customEl = container.querySelector<HTMLElement>(`.${CUSTOM_VIEW_CLASS}`);
		if (!customEl || this.containerIsRenderedForFile(container, file)) return;

		customEl.addClass(PENDING_VIEW_CLASS);
	}

	private containerIsRenderedForFile(container: HTMLElement, file: TFile): boolean {
		const renderedFilePath = container.getAttribute("data-cv-file-path");
		if (renderedFilePath) return renderedFilePath === file.path;

		const appliedState = container.getAttribute("data-cv-state");
		return appliedState?.startsWith(`${file.path}::`) ?? false;
	}

	private setAppliedState(container: HTMLElement, file: TFile, stateKey: string) {
		container.setAttribute("data-cv-state", stateKey);
		container.setAttribute("data-cv-file-path", file.path);
	}

	private clearAppliedState(container: HTMLElement) {
		container.removeAttribute("data-cv-state");
		container.removeAttribute("data-cv-file-path");
	}

	private getViewSourceContent(view: MarkdownView, file: TFile): string | undefined {
		const state = view.getState();
		if (state.mode !== "source" || state.source !== false) {
			return undefined;
		}

		if (view.file !== file) {
			return undefined;
		}

		try {
			return view.getViewData();
		} catch {
			return undefined;
		}
	}

	/**
	 * Synchronously hides the markdown content for a file if it matches a view config.
	 * Called before the setTimeout in event handlers to eliminate flicker — the markdown
	 * is hidden immediately, then the async render fills in the custom view content.
	 * Only adds a CSS class (no DOM rearrangement), so it does not steal focus.
	 *
	 * Pre-hiding is restricted to reading mode on purpose. The hide class sets
	 * `display: none` on `.markdown-source-view`; doing that to a live-preview
	 * editor while it is performing its first layout makes CM6 measure a
	 * zero-height viewport and render blank — and editable mode reparents that
	 * very editor, so it would stay blank. Live preview has nothing to pre-hide
	 * anyway (the editor is reparented, not replaced), so we simply skip it.
	 */
	private preHideIfMatch(file: TFile) {
		if (!this.settings.enabled) return;
		const cache = this.app.metadataCache.getFileCache(file);
		const matches = this.settings.views.some(v =>
			this.nativeRules.matches(v, file, cache?.frontmatter)
		);
		if (!matches) return;

		// Only use iterateAllLeaves with file matching — getLeaf(false) would hide the
		// active leaf unconditionally, which sets display:none on .cm-editor and causes
		// Obsidian to lose the file explorer's has-focus tracking.
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (
				leaf.view instanceof MarkdownView &&
				leaf.view.file === file &&
				leaf.view.getState().mode === "preview"
			) {
				leaf.view.contentEl.addClass(HIDE_MARKDOWN_CLASS);
			}
		});
	}

	async processActiveView(file: TFile | null) {
		if (!file || this.unloaded) return;
		const pending: Promise<void>[] = [];
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view instanceof MarkdownView && leaf.view.file === file) {
				pending.push(this._processLeaf(leaf.view, file));
			}
		});
		await Promise.all(pending);
	}

	/**
	 * Computes a state key that uniquely identifies what should currently be
	 * displayed. When the key matches what's already applied, we skip all DOM
	 * work — avoiding the event cascade that our overlay injection triggers
	 * (active-leaf-change → file-open → layout-change → re-inject).
	 */
	private computeStateKey(
		file: TFile,
		view: MarkdownView,
		matchedConfig: ViewConfig | null
	): string {
		const state = view.getState();
		const mode = state.mode === 'source'
			? (state.source ? 'source' : 'livepreview')
			: 'preview';
		const configId = matchedConfig?.id ?? 'none';
		return `${file.path}::${configId}::${mode}::${this.settingsVersion}`;
	}

	private _processLeaf(view: MarkdownView, file: TFile): Promise<void> {
		if (this.unloaded || view.file !== file) return Promise.resolve();
		const state = view.getState();
		const key = JSON.stringify([file.path, file.stat.mtime, state.mode, state.source, this.settingsVersion, this.contentVersions.get(view)]);
		const metadata = JSON.stringify(this.app.metadataCache.getFileCache(file)?.frontmatter ?? {});
		return this.renders.run(view, key, async signal => {
			await this.renderLeaf(view, file, signal);
			if (!signal.aborted && view.file === file) this.renderedMetadata.set(view, { path: file.path, value: metadata });
		}).catch(error => {
			this.restoreEditableView(view);
			this.restoreDefaultView(view);
			console.error("[Custom Views] Failed to render note:", error);
		});
	}

	private async renderLeaf(view: MarkdownView, file: TFile, signal: AbortSignal) {
		const container = view.contentEl;

		if (!this.settings.enabled) {
			this.restoreEditableView(view);
			this.restoreDefaultView(view);
			this.clearAppliedState(container);
			return;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		let matchedConfig: ViewConfig | null = null;

		for (const viewConfig of this.settings.views) {
			const isMatch = this.nativeRules.matches(viewConfig, file, cache?.frontmatter);
			if (isMatch) {
				matchedConfig = viewConfig;
				break;
			}
		}

		const stateKey = this.computeStateKey(file, view, matchedConfig);
		const appliedKey = container.getAttribute("data-cv-state");
		const state = view.getState();
		const isTrueSourceMode = state.mode === 'source' && state.source === true;
		const isReadingMode = state.mode === 'preview';
		const isLivePreviewMode = state.mode === 'source' && state.source === false;
		const shouldRenderCustomView = !!matchedConfig &&
			!isTrueSourceMode &&
			(this.settings.workInLivePreview || isReadingMode);

		// Skip if nothing changed — prevents DOM churn and event cascades
		if (stateKey === appliedKey) {
			const customEl = container.querySelector(`.${CUSTOM_VIEW_CLASS}`);
			const appliedDomIsValid = shouldRenderCustomView ? !!customEl : !customEl;
			if (appliedDomIsValid) {
				customEl?.removeClass(PENDING_VIEW_CLASS);
				return;
			}
		}
		if (!matchedConfig) {
			this.restoreEditableView(view);
			this.restoreDefaultView(view);
			this.setAppliedState(container, file, stateKey);
			return;
		}

		const matchedTemplate = matchedConfig.template;

		if (isTrueSourceMode) {
			this.restoreEditableView(view);
			this.restoreDefaultView(view);
			this.setAppliedState(container, file, stateKey);
			return;
		}

		if (!this.settings.workInLivePreview && !isReadingMode) {
			this.restoreEditableView(view);
			this.restoreDefaultView(view);
			this.setAppliedState(container, file, stateKey);
			return;
		}

		// Check if we should use editable mode
		const canUseEditableMode =
			this.settings.editableContent &&
			this.settings.workInLivePreview &&
			isLivePreviewMode &&
			templateHasEditableContent(matchedTemplate);

		if (canUseEditableMode) {
			await this.injectEditableView(view, file, matchedConfig, signal);
		} else {
			this.restoreEditableView(view);
			await this.injectCustomView(view.contentEl, file, matchedTemplate, matchedConfig, this.getViewSourceContent(view, file), signal);
		}

		if (view.file === file && !this.unloaded && !signal.aborted) {
			this.setAppliedState(container, file, stateKey);
		}
	}

	// ─── Read-only Overlay (existing behavior) ─────────────────────────────────

	async injectCustomView(
		container: HTMLElement,
		file: TFile,
		template: string,
		viewConfig?: ViewConfig,
		sourceContent?: string,
		signal?: AbortSignal,
	) {
		// Hide markdown immediately — synchronously, before any async template work begins.
		// This closes the gap where file-open fired but preHideIfMatch didn't catch the leaf
		// yet (because leaf.view.file hadn't updated). The container is already the correct
		// one (found via iterateAllLeaves in processActiveView), so this is safe.
		container.addClass(HIDE_MARKDOWN_CLASS);

		const previousOverlay = container.querySelector<HTMLElement>(`.${CUSTOM_VIEW_CLASS}`);
		const customEl = container.ownerDocument.createElement("div");
		customEl.addClass(CUSTOM_VIEW_CLASS);
		container.appendChild(customEl);
		this.registerOverlayLinkHandlers(customEl, file.path);
		const cancel = () => customEl.remove();
		signal?.addEventListener("abort", cancel, { once: true });

		let scopeId = container.getAttribute("data-cv-id");
		if (!scopeId) {
			scopeId = `cv-${this.nextScopeId++}`;
			container.setAttribute("data-cv-id", scopeId);
		}

		customEl.addClass(PENDING_VIEW_CLASS);
		try {
			await renderTemplate(
				this.app,
				template,
				file,
				customEl,
				this,
				false,
				viewConfig,
				scopeId,
				this.settings.allowJavaScript,
				sourceContent,
				this.basesProvider,
				signal,
			);
			if (signal?.aborted || this.unloaded) { customEl.remove(); return; }
			previousOverlay?.remove();
			customEl.removeClass(PENDING_VIEW_CLASS);
		} catch (error) {
			customEl.remove();
			throw error;
		} finally {
			signal?.removeEventListener("abort", cancel);
		}

		this.applyViewDisplayOptions(container, viewConfig);
		container.addClass(HIDE_MARKDOWN_CLASS);
	}

	restoreDefaultView(view: MarkdownView) {
		const container = view.contentEl;

		this.restoreDisplayOptions(container);
		container.removeClass(HIDE_MARKDOWN_CLASS);
		container.removeClass(EDITABLE_MODE_CLASS);
		container.removeAttribute("data-cv-id");
		this.clearAppliedState(container);

		const customEl = container.querySelector(`.${CUSTOM_VIEW_CLASS}`);
		if (customEl) {
			customEl.remove();
		}
	}

	/**
	 * Re-creates Obsidian's native link interactions for links that the
	 * MarkdownRenderer produced inside our overlay.
	 *
	 * The overlay (`.${CUSTOM_VIEW_CLASS}`) is a detached element appended to the
	 * leaf's contentEl — it is NOT the leaf's reading view, so it does not inherit
	 * the per-preview link handlers Obsidian attaches for clicks and context
	 * menus. Without this, right-clicking a rendered link falls through to the
	 * generic selection menu ("Copy" only) instead of the native file/URL menu,
	 * and internal links don't open on click.
	 *
	 * External-link *clicks* are intentionally left to Obsidian's Electron
	 * `will-navigate` handler, which already opens http(s) URLs in the default
	 * browser — handling them here too would open them twice.
	 *
	 * @param customEl     overlay element to delegate events from
	 * @param sourcePath   path of the rendered file, used as the link-resolution base
	 * @param skipSelector optional selector; events originating inside a matching
	 *                     element are ignored (the reparented CM6 editor in
	 *                     editable mode handles its own clicks and context menus)
	 */
	private registerOverlayLinkHandlers(customEl: HTMLElement, sourcePath: string) {
		customEl.setAttribute("data-cv-source-path", sourcePath);
		const host = customEl.parentElement ?? customEl;
		if (this.overlayLinkHosts.has(host)) return;
		this.overlayLinkHosts.add(host);
		this.registerDomEvent(host, "click", (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			if (target.closest(".markdown-source-view")) return;
			const overlay = target.closest(`.${CUSTOM_VIEW_CLASS}`);
			if (!overlay) return;
			const sourcePath = overlay.getAttribute("data-cv-source-path") ?? "";

			const link = target.closest(".internal-link");
			if (link && link.instanceOf(HTMLAnchorElement)) {
				evt.preventDefault();
				const href = link.getAttribute("data-href") || link.getAttribute("href");
				if (href) {
					const newLeaf = Keymap.isModEvent(evt);
					void this.app.workspace.openLinkText(href, sourcePath, newLeaf);
				}
			}
		});

		this.registerDomEvent(host, "contextmenu", (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			if (target.closest(".markdown-source-view")) return;
			const overlay = target.closest(`.${CUSTOM_VIEW_CLASS}`);
			if (!overlay) return;
			const sourcePath = overlay.getAttribute("data-cv-source-path") ?? "";

			const internalLink = target.closest(".internal-link");
			const externalLink = internalLink ? null : target.closest(".external-link");
			const linkEl = internalLink ?? externalLink;
			if (!linkEl || !linkEl.instanceOf(HTMLAnchorElement)) return;

			const href = linkEl.getAttribute("data-href") || linkEl.getAttribute("href");
			if (!href) return;

			// `handleLinkContextMenu` / `handleExternalLinkContextMenu` are internal
			// Workspace methods (not in the public typings). They build Obsidian's
			// exact native link menu and fire the `file-menu` / `url-menu` events so
			// other plugins can contribute. Access them defensively so a future API
			// change degrades gracefully instead of throwing.
			const workspace = this.app.workspace as unknown as {
				handleLinkContextMenu?(menu: Menu, linktext: string, sourcePath: string): boolean;
				handleExternalLinkContextMenu?(menu: Menu, url: string): boolean;
			};

			if (internalLink) {
				if (typeof workspace.handleLinkContextMenu !== "function") return;
				// Menu.forEvent calls preventDefault, auto-shows on the next tick, and
				// de-dupes per event — so our items merge with any other contributor
				// (e.g. the selection "Copy") into a single native menu.
				const menu = Menu.forEvent(evt);
				workspace.handleLinkContextMenu(menu, href, sourcePath);
			} else {
				if (typeof workspace.handleExternalLinkContextMenu !== "function") return;
				const menu = Menu.forEvent(evt);
				workspace.handleExternalLinkContextMenu(menu, href);
			}
		});
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

	private async injectEditableView(
		view: MarkdownView,
		file: TFile,
		viewConfig: ViewConfig,
		signal?: AbortSignal,
	) {
		const container = view.contentEl;
		const template = viewConfig.template;
		const sourceContent = this.getViewSourceContent(view, file);

		// Get the CM6 editor view
		const cmView = getCM6EditorView(view);
		if (!cmView) {
			// Fallback: if we can't access CM6, use the read-only overlay
			console.warn("[Custom Views] Could not access CM6 EditorView, falling back to read-only mode.");
			this.restoreEditableView(view);
			await this.injectCustomView(container, file, template, viewConfig, sourceContent, signal);
			return;
		}

		// Find the editor element (.markdown-source-view)
		const editorEl = container.querySelector(".markdown-source-view") as HTMLElement;
		if (!editorEl) {
			this.restoreEditableView(view);
			await this.injectCustomView(container, file, template, viewConfig, sourceContent, signal);
			return;
		}

		// Keep the editor in place while preparing the next shell. Restoring and
		// reconfiguring CM6 twice per navigation forces extra layout and parsing.
		const previousOverlay = container.querySelector<HTMLElement>(`.${CUSTOM_VIEW_CLASS}`);
		const previousState = this.editableStates.get(container);
		const customEl = container.ownerDocument.createElement("div");
		customEl.addClass(CUSTOM_VIEW_CLASS);
		customEl.addClass(PENDING_VIEW_CLASS);
		container.appendChild(customEl);
		this.registerOverlayLinkHandlers(customEl, file.path);
		const cancel = () => customEl.remove();
		signal?.addEventListener("abort", cancel, { once: true });

		// Assign a unique scope ID for CSS isolation
		let scopeId = container.getAttribute("data-cv-id");
		if (!scopeId) {
			scopeId = `cv-${this.nextScopeId++}`;
			container.setAttribute("data-cv-id", scopeId);
		}

		// Render template with editableMode=true (content placeholder left empty)
		customEl.addClass(PENDING_VIEW_CLASS);
		try {
			await renderTemplate(
				this.app,
				template,
				file,
				customEl,
				this,
				true,
				viewConfig,
				scopeId,
				this.settings.allowJavaScript,
				sourceContent,
				this.basesProvider,
				signal,
			);
		} catch (error) {
			customEl.remove();
			throw error;
		} finally {
			signal?.removeEventListener("abort", cancel);
		}
		if (view.file !== file || this.unloaded || signal?.aborted) {
			customEl.remove();
			return;
		}

		// Find the content placeholder
		const placeholder = customEl.querySelector(`[${EDITABLE_PLACEHOLDER_ATTR}]`) as HTMLElement;
		if (!placeholder) {
			// Template has no content placeholder? Fall back to read-only.
			this.restoreEditableView(view);
			previousOverlay?.remove();
			customEl.removeClass(PENDING_VIEW_CLASS);
			container.addClass(HIDE_MARKDOWN_CLASS);
			return;
		}

		// Save state for restoration
		const originalParent = previousState?.originalParent ?? editorEl.parentElement!;
		const originalNextSibling = previousState ? previousState.originalNextSibling : editorEl.nextSibling;

		// Get or create a compartment for this editor (reused across navigations)
		const compartment = this.getOrCreateCompartment(cmView);

		// Configure with our extensions
		if (!previousState || previousState.cmView !== cmView) {
			cmView.dispatch({
				effects: compartment.reconfigure(createEditableContentExtensions())
			});
		}

		// Reparent the editor into the placeholder
		placeholder.appendChild(editorEl);
		previousOverlay?.remove();
		customEl.removeClass(PENDING_VIEW_CLASS);
		container.removeClass(HIDE_MARKDOWN_CLASS);

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

		this.restoreDisplayOptions(container);

		// Remove editable mode class and overlay
		container.removeClass(EDITABLE_MODE_CLASS);

		const customEl = container.querySelector(`.${CUSTOM_VIEW_CLASS}`);
		if (customEl) customEl.remove();

		// Clean up state
		this.editableStates.delete(container);
	}

	// ─── Per-view Display Options ──────────────────────────────────────────────

	/**
	 * Applies per-view display options (show/hide properties and inline title).
	 * Uses CSS classes following the obsidian-hider pattern.
	 *
	 * Note: these options only take effect in editing view (live preview)
	 * because MarkdownRenderer.render() does not produce the native
	 * .metadata-container or .inline-title elements in reading view.
	 */
	private applyViewDisplayOptions(container: HTMLElement, viewConfig?: ViewConfig) {
		if (!viewConfig) return;
		container.toggleClass("cv-hide-properties", viewConfig.showProperties === false);
		container.toggleClass("cv-hide-inline-title", viewConfig.showInlineTitle === false);
	}

	private restoreDisplayOptions(container: HTMLElement) {
		container.removeClass("cv-hide-properties");
		container.removeClass("cv-hide-inline-title");
	}

	// ─── Settings ──────────────────────────────────────────────────────────────

	async loadSettings() {
		const loadedData = await this.loadData() as Partial<CustomViewsSettings> | null;
		this.settings = Object.assign(structuredClone(DEFAULT_SETTINGS), loadedData);
	}

	async saveSettings() {
		await this.settingsWriter.save(this.settings);
	}

	/**
	 * Bump the settings version and re-render all open views.
	 * Called after view config changes (edit modal close, view deletion, etc.)
	 */
	refreshAllViews() {
		this.settingsVersion++;
		this.prepareScriptEngine();
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.file) {
				void this._processLeaf(leaf.view, leaf.view.file);
			}
		});
		if (this.settings.workInCanvas) {
			void this.processAllCanvasNodes();
		}
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
		let matchedConfig: ViewConfig | null = null;

		for (const viewConfig of this.settings.views) {
			const isMatch = this.nativeRules.matches(viewConfig, file, cache?.frontmatter);
			if (isMatch) {
				matchedConfig = viewConfig;
				break;
			}
		}
		if (!matchedConfig) {
			this.restoreCanvasNode(node);
			return;
		}

		// Find the node's content element
		const nodeEl = node.nodeEl as HTMLElement;
		if (!nodeEl) return;

		// Find the markdown preview container within the node
		const previewContainer = nodeEl.querySelector(".markdown-preview-view") as HTMLElement;
		if (!previewContainer) return;

		await this.injectCustomView(previewContainer, file, matchedConfig.template, matchedConfig);
	}

	/**
	 * Restore a canvas node to default view
	 */
	restoreCanvasNode(node: CanvasNode) {
		const nodeEl = node.nodeEl as HTMLElement;
		if (!nodeEl) return;

		const previewContainer = nodeEl.querySelector(".markdown-preview-view") as HTMLElement;
		if (!previewContainer) return;

		this.restoreDisplayOptions(previewContainer);

		previewContainer.removeClass(HIDE_MARKDOWN_CLASS);
		previewContainer.removeAttribute("data-cv-id");

		const customEl = previewContainer.querySelector(`.${CUSTOM_VIEW_CLASS}`);
		if (customEl) {
			customEl.remove();
		}
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
