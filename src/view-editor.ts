import { FuzzySuggestModal, ItemView, MarkdownView, Notice, Menu, Platform, type MenuItem, type FuzzyMatch, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { createView } from "./new-view";
import { conflictingView } from "./view-name";
import type CustomViewsPlugin from "./main";
import type { ViewConfig, ViewContext } from "./types";

import { registerCodePopout } from "./view-editor-popout";
import { EditorWorkbench, normalizeWorkbench } from "./view-editor-workbench";

export const VIEW_EDITOR_TYPE = "custom-views-editor";

/** Native workspace tab for editing templates against a selected note. */
export class ViewEditor extends ItemView {
	private viewId = "";
	private context: ViewContext = "note";
	private workbench?: EditorWorkbench;
	private layoutState = normalizeWorkbench();

	constructor(leaf: WorkspaceLeaf, private plugin: CustomViewsPlugin) { super(leaf); }

	getViewType() { return VIEW_EDITOR_TYPE; }
	getIcon() { return "code-xml"; }
	getDisplayText() {
		const name = this.plugin.settings.views.find(view => view.id === this.viewId)?.name;
		return name ? `Edit ${name}` : "View editor";
	}
	getState() { const context = this.workbench?.getContext() ?? this.context; return { viewId: this.viewId, ...(context === "note" ? {} : { context }), layout: this.layoutState }; }
	async setState(state: unknown, result: ViewStateResult) {
		this.viewId = state && typeof state === "object" && "viewId" in state && typeof state.viewId === "string" ? state.viewId : "";
		const context = state && typeof state === "object" && "context" in state ? state.context : undefined;
		this.context = context === "popover" || context === "canvas" || context === "embed" ? context : "note";
		this.layoutState = normalizeWorkbench(state && typeof state === "object" && "layout" in state ? state.layout : {});
		await super.setState(state, result);
		this.mount();
	}
	async onOpen() { this.mount(); }
	async onClose() { this.workbench?.dispose(); this.workbench = undefined; }
	private mount() {
		this.workbench?.dispose(); this.workbench = undefined;
		const config = this.plugin.settings.views.find(view => view.id === this.viewId);
		if (!config) { this.contentEl.empty(); return; }
		this.workbench = new EditorWorkbench(this.plugin, this.contentEl, config, this.context, this.layoutState, () => this.app.workspace.requestSaveLayout(), this.leaf);
	}
	onPaneMenu(menu: Menu, source: string) {
		super.onPaneMenu(menu, source);
		menu.addItem(item => {
			item.setTitle("Code panel position").setIcon("panels-top-left").setSection("view");
			const submenu = (item as MenuItem & { setSubmenu(): Menu }).setSubmenu();
			if (Platform.isDesktopApp) submenu.addItem(option => option.setTitle("Separate window").setIcon("picture-in-picture-2").setChecked(this.workbench?.isUndocked() ?? false).onClick(() => { void this.workbench?.undock(); }));
			for (const [dock, icon] of [["left","panel-left"],["right","panel-right"],["top","panel-top"],["bottom","panel-bottom"]] as const)
				submenu.addItem(option => option.setTitle(dock[0].toUpperCase()+dock.slice(1)).setIcon(icon).setChecked(!this.workbench?.isUndocked() && this.layoutState.dock === dock).onClick(() => this.workbench?.setDock(dock)));
		});
	}
}

export class ViewEditorPicker extends FuzzySuggestModal<ViewConfig> {
	private readonly currentViewId?: string;
	private creation?: ViewConfig;
	private creating = false;
	private readonly closeOnUnload = () => this.close();

	constructor(private plugin: CustomViewsPlugin) {
		super(plugin.app);
		const note = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		this.currentViewId = note ? plugin.findMatchingView(note, true)?.id : undefined;
		this.setPlaceholder("Open view editor…");
		this.emptyStateText = "No views found.";
		// Same instructions and badge structure as Obsidian 1.14.1's vault picker.
		this.setInstructions([
			{ command: "↑↓", purpose: "to navigate" },
			{ command: "↵", purpose: "to open" },
			{ command: "shift ↵", purpose: "to create" },
			{ command: "esc", purpose: "to dismiss" },
		]);
		this.scope.register(["Shift"], "Enter", event => {
			if (event.isComposing) return;
			void this.createFromQuery();
			return false;
		});
	}
	async onOpen() {
		await super.onOpen();
		this.plugin.unloadSignal.addEventListener("abort", this.closeOnUnload, { once: true });
		if (this.plugin.unloadSignal.aborted) this.close();
	}
	onClose() {
		this.plugin.unloadSignal.removeEventListener("abort", this.closeOnUnload);
		super.onClose();
	}
	getSuggestions(query: string): FuzzyMatch<ViewConfig>[] {
		const matches = super.getSuggestions(query);
		this.creation = undefined;
		if (matches.length || !query.trim()) return matches;
		this.creation = createView(query.trim());
		return [{ item: this.creation, match: { score: 0, matches: [] } }];
	}
	getItems() { return this.plugin.settings.views; }
	getItemText(view: ViewConfig) { return view.name; }
	renderSuggestion(match: FuzzyMatch<ViewConfig>, el: HTMLElement) {
		if (match.item === this.creation) {
			el.addClass("mod-complex");
			el.createDiv("suggestion-content").createDiv({ cls: "suggestion-title", text: match.item.name });
			el.createDiv("suggestion-aux").createSpan({ cls: "suggestion-hotkey", text: "Enter to create" });
			return;
		}
		super.renderSuggestion(match, el);
		if (match.item.id === this.currentViewId) el.createSpan({ cls: "flair mod-pop", text: "Current note" });
	}
	onChooseItem(view: ViewConfig) {
		if (view === this.creation) { void this.createFromQuery(view.name); return; }
		if (this.plugin.unloadSignal.aborted || !this.plugin.settings.views.some(item => item.id === view.id)) return;
		void openViewEditorTab(this.plugin, view).catch(() => new Notice("Could not open view editor."));
	}
	private async createFromQuery(query = this.inputEl.value) {
		if (this.creating || this.plugin.unloadSignal.aborted) return;
		let name = query.trim();
		if (!name) {
			name = "New View";
			for (let suffix = 2; conflictingView(this.plugin.settings.views, name); suffix++) name = `New View ${suffix}`;
		} else if (conflictingView(this.plugin.settings.views, name)) {
			new Notice("A view with this name already exists."); return;
		}
		this.creating = true;
		const view = createView(name);
		this.plugin.settings.views.push(view);
		try {
			await this.plugin.saveSettings();
		} catch {
			const index = this.plugin.settings.views.indexOf(view);
			if (index >= 0) this.plugin.settings.views.splice(index, 1);
			this.creating = false;
			new Notice("Could not create the view. Try again."); return;
		}
		this.close();
		try { await openViewEditorTab(this.plugin, view); }
		catch { new Notice("View created. Use the command to reopen its editor."); }
		finally { this.creating = false; }
	}
}

/** Shared by the picker and the settings action; no rendering or template execution. */
export async function openViewEditorTab(plugin: CustomViewsPlugin, view: ViewConfig, context: ViewContext = "note") {
	if (plugin.unloadSignal.aborted || !plugin.settings.views.some(item => item.id === view.id)) return;
	const note = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file;
	const leaf = plugin.app.workspace.getLeaf("tab");
	await leaf.setViewState({ type: VIEW_EDITOR_TYPE, active: true,
		state: { viewId: view.id, ...(context === "note" ? {} : { context }), ...(note?.path ? { layout: { notePath: note.path } } : {}) } });
	if (!plugin.unloadSignal.aborted) await plugin.app.workspace.revealLeaf(leaf);
}

export function registerViewEditor(plugin: CustomViewsPlugin) {
	registerCodePopout(plugin);
	plugin.registerView(VIEW_EDITOR_TYPE, leaf => new ViewEditor(leaf, plugin));
	plugin.addCommand({
		id: "open-view-editor",
		name: "Open view editor",
		callback: () => new ViewEditorPicker(plugin).open(),
	});
}
