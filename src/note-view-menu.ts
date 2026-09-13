import { MarkdownView, TFile, type Menu, type MenuItem, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import type CustomViewsPlugin from "./main";
import type { ViewConfig } from "./types";

interface TabOverride {
	file: TFile;
	view: MarkdownView;
	configId: string;
	enabled: boolean;
}

/** Menu integration uses the public workspace event; overrides never enter saved settings. */
export class NoteViewMenu {
	private overrides = new Map<WorkspaceLeaf, TabOverride>();
	constructor(private plugin: CustomViewsPlugin) {
		const workspace = plugin.app.workspace;
		plugin.registerEvent(workspace.on("file-menu", (menu, file, source, leaf) => this.populate(menu, file, source, leaf)));
		plugin.registerEvent(workspace.on("file-open", () => this.prune()));
		plugin.registerEvent(workspace.on("active-leaf-change", () => this.prune()));
		plugin.registerEvent(workspace.on("layout-change", () => this.prune()));
		plugin.register(() => this.overrides.clear());
	}

	private prune() {
		const leaves = new Set<WorkspaceLeaf>();
		this.plugin.app.workspace.iterateAllLeaves(leaf => leaves.add(leaf));
		for (const [leaf, state] of this.overrides) {
			if (!leaves.has(leaf) || leaf.view !== state.view || state.view.file !== state.file) this.overrides.delete(leaf);
		}
	}

	/** undefined means use saved settings; null means show native Markdown in this tab. */
	resolve(view: MarkdownView, file: TFile): ViewConfig | null | undefined {
		const state = this.overrides.get(view.leaf);
		if (!state) return undefined;
		if (state.view !== view || state.file !== file) {
			this.overrides.delete(view.leaf);
			return undefined;
		}
		const match = this.plugin.findMatchingView(file, true);
		if (match?.id !== state.configId) {
			this.overrides.delete(view.leaf);
			return undefined;
		}
		return state.enabled ? match : null;
	}

	populate(menu: Menu, file: TAbstractFile, source: string, leaf?: WorkspaceLeaf) {
		if (source !== "more-options" || !(file instanceof TFile) || !leaf ||
			!(leaf.view instanceof MarkdownView) || leaf.view.file !== file) return;
		const view = leaf.view;
		const match = this.plugin.findMatchingView(file, true);
		if (!match) return;
		const current = () => !this.plugin.unloadSignal.aborted && leaf.view === view && view.file === file &&
			this.plugin.findMatchingView(file, true) === match;
		const enabled = match.enabled !== false;
		const title = `“${match.name}”`;
		// Obsidian orders the default extension section immediately before danger.
		const section = "";
		const active = this.plugin.getEffectiveView(view, file)?.id === match.id;
		const globalLabel = `${enabled ? "Disable" : "Enable"} everywhere`;
		const tabLabel = active ? "Pause in this tab" : "Show in this tab";
		const toggleEverywhere = () => {
			if (!current()) return;
			match.enabled = !enabled;
			this.overrides.delete(leaf);
			this.plugin.refreshAllViews();
			void this.plugin.saveSettings().catch(() => {});
		};
		const toggleTab = () => {
			if (!current()) return;
			this.overrides.set(leaf, { file, view, configId: match.id, enabled: !active });
			this.plugin.refreshTabView(view);
		};
		const addReset = (target: Menu) => {
			if (!this.overrides.has(leaf)) return;
			target.addItem(item => item.setSection(section).setTitle("Use saved setting")
				.setIcon("rotate-ccw").onClick(() => {
					if (!current()) return;
					this.overrides.delete(leaf);
					this.plugin.refreshTabView(view);
				}));
		};
		let nested = false;
		menu.addItem(item => {
			item.setSection(section);
			// Native Obsidian 1.14.1 API, intentionally isolated: not in public typings.
			const native = item as MenuItem & { setSubmenu?: () => Menu };
			if (typeof native.setSubmenu !== "function") {
				item.setTitle(globalLabel).setIcon(enabled ? "eye-off" : "eye").onClick(toggleEverywhere);
				return;
			}
			nested = true;
			item.setTitle("View visibility").setIcon("eye");
			const submenu = native.setSubmenu();
			submenu.addItem(child => child.setTitle(globalLabel)
				.setIcon(enabled ? "eye-off" : "eye").onClick(toggleEverywhere));
			submenu.addItem(child => child.setTitle(tabLabel)
				.setIcon("panel-top").onClick(toggleTab));
			addReset(submenu);
		});
		if (!nested) {
			menu.addItem(item => item.setSection(section).setTitle(tabLabel)
				.setIcon("panel-top").onClick(toggleTab));
			addReset(menu);
		}
		menu.addItem(item => item.setSection(section).setTitle(`Edit ${title}`).setIcon("settings")
			.onClick(() => { if (current()) this.plugin.openViewEditor(match); }));
		if (!this.plugin.settings.enabled) {
			menu.addItem(item => item.setSection(section).setTitle("Enable custom views globally").setIcon("power")
				.onClick(() => { if (current()) void this.plugin.setPluginState(true).catch(() => {}); }));
		}
	}
}
