import { describe, expect, it, vi } from "vitest";
import { App, MarkdownView, TFile, WorkspaceLeaf, type Menu, type PluginManifest } from "obsidian";
import CustomViewsPlugin from "../main";
import { DEFAULT_SETTINGS } from "../settings";
import { NoteViewMenu } from "../note-view-menu";
import { NativeRuleEngine } from "../native-filters/engine";

interface TestItem { title: string; section: string; click: () => void; children: TestItem[] }

function setup(nativeSubmenu = true) {
	const file = Object.assign(new TFile(), { path: "A.md" });
	const other = Object.assign(new TFile(), { path: "B.md" });
	const leaf = new WorkspaceLeaf(); const second = new WorkspaceLeaf();
	const view = Object.assign(new MarkdownView(leaf), { file, leaf });
	const sibling = Object.assign(new MarkdownView(second), { file, leaf: second });
	leaf.view = view; second.view = sibling;
	const leaves = [leaf, second];
	const events = new Map<string, (...args: unknown[]) => void>();
	const disposers: (() => void)[] = [];
	const plugin = new CustomViewsPlugin(new App(), {} as PluginManifest);
	plugin.app = { workspace: {
		on: (name: string, fn: (...args: unknown[]) => void) => { events.set(name, fn); return {}; },
		iterateAllLeaves: (fn: (leaf: WorkspaceLeaf) => void) => leaves.forEach(fn),
	}, metadataCache: { getFileCache: () => ({}) } } as unknown as App;
	plugin.settings = structuredClone(DEFAULT_SETTINGS);
	plugin.settings.views = [
		{ ...plugin.settings.views[0], id: "first", name: "First", enabled: false, basesFilters: null },
		{ ...plugin.settings.views[0], id: "second", name: "Second", basesFilters: null },
	];
	plugin.nativeRules = new NativeRuleEngine(plugin.app);
	Object.assign(plugin, { registerEvent: vi.fn(), register: (fn: () => void) => disposers.push(fn) });
	const refreshAll = vi.spyOn(plugin, "refreshAllViews").mockImplementation(() => {});
	const refreshTab = vi.spyOn(plugin, "refreshTabView").mockImplementation(() => {});
	const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue(undefined);
	const edit = vi.spyOn(plugin, "openViewEditor").mockImplementation(() => {});
	const menus = new NoteViewMenu(plugin); Object.assign(plugin, { noteViewMenu: menus });
	function menu(source = "more-options", target = file, targetLeaf: WorkspaceLeaf | undefined = leaf) {
		const items: TestItem[] = [];
		const makeMenu = (items: TestItem[]): Menu => ({ addItem: (cb: (item: unknown) => void) => {
			const state: TestItem = { title: "", section: "", click: () => {}, children: [] };
			const item = {
				setTitle: (value: string) => { state.title = value; return item; },
				setSection: (value: string) => { state.section = value; return item; },
				setIcon: () => item,
				onClick: (fn: () => void) => { state.click = fn; return item; },
				...(nativeSubmenu ? { setSubmenu: () => makeMenu(state.children) } : {}),
			};
			cb(item); items.push(state);
		} } as unknown as Menu);
		menus.populate(makeMenu(items), target, source, targetLeaf);
		return items;
	}
	return { file, other, leaf, second, view, sibling, plugin, menus, menu, events, leaves, disposers, refreshAll, refreshTab, save, edit };
}

describe("note view menu", () => {
	it("uses the documented event and first match including disabled views", () => {
		const s = setup();
		expect(s.events.has("file-menu")).toBe(true);
		expect(s.plugin.getEffectiveView(s.view, s.file)?.name).toBe("Second");
		const items = s.menu();
		expect(items.map(x => x.title)).toEqual(['View visibility', 'Edit “First”']);
		expect(items.every(x => x.section === "")).toBe(true);
		items[1].click(); expect(s.edit).toHaveBeenCalledWith(s.plugin.settings.views[0]);
		items[0].children[0].click(); expect(s.plugin.settings.views[0].enabled).toBe(true);
		expect(s.save).toHaveBeenCalledOnce(); expect(s.refreshAll).toHaveBeenCalledOnce();
	});
	it("groups scopes natively and labels mixed states explicitly", () => {
		const s = setup();
		expect(s.menu()[0].children.map(item => item.title)).toEqual(["Enable everywhere", "Show in this tab"]);
		s.plugin.settings.views[0].enabled = true;
		expect(s.menu()[0].title).toBe("View visibility");
		s.menu()[0].children[1].click();
		const mixed = s.menu()[0];
		expect(mixed.title).toBe("View visibility");
		expect(mixed.children.map(item => item.title)).toEqual(["Disable everywhere", "Show in this tab", "Use saved setting"]);
		mixed.children[1].click();
		expect(s.menu()[0].title).toBe("View visibility");
	});
	it("keeps actions available if the native submenu method is unavailable", () => {
		const s = setup(false);
		const items = s.menu();
		expect(items.map(item => item.title)).toEqual(["Enable everywhere", "Show in this tab", 'Edit “First”']);
		items[1].click();
		expect(s.plugin.getEffectiveView(s.view, s.file)?.name).toBe("First");
		items[0].click();
		expect(s.save).toHaveBeenCalledOnce();
	});

	it("omits other menu sources, missing tabs, folders/non-markdown views and unmatched notes", () => {
		const s = setup();
		for (const source of ["file-explorer-context-menu", "link-context-menu", "tab-header"]) expect(s.menu(source)).toEqual([]);
		expect(s.menu("more-options", s.file, {} as WorkspaceLeaf)).toEqual([]);
		expect(s.menu("more-options", s.other)).toEqual([]);
		s.plugin.settings.views = []; expect(s.menu()).toEqual([]);
	});
	it("temporarily enables only the target tab, including when globally disabled, without saving", () => {
		const s = setup(); s.plugin.settings.enabled = false;
		const saved = structuredClone(s.plugin.settings);
		s.menu()[0].children[1].click();
		expect(s.plugin.getEffectiveView(s.view, s.file)?.name).toBe("First");
		expect(s.plugin.getEffectiveView(s.sibling, s.file)).toBeNull();
		expect(s.plugin.settings).toEqual(saved); expect(s.save).not.toHaveBeenCalled();
		expect(s.refreshTab).toHaveBeenCalledWith(s.view);
		s.menu()[0].children.find(item => item.title === "Use saved setting")!.click();
		expect(s.plugin.getEffectiveView(s.view, s.file)).toBeNull();
	});
	it("temporarily disables the tab without falling through to another matching view", () => {
		const s = setup(); s.plugin.settings.views[0].enabled = true;
		s.menu()[0].children[1].click();
		expect(s.plugin.getEffectiveView(s.view, s.file)).toBeNull();
		expect(s.plugin.getEffectiveView(s.sibling, s.file)?.name).toBe("First");
		s.menu()[0].children[1].click(); expect(s.plugin.getEffectiveView(s.view, s.file)?.name).toBe("First");
		expect(s.save).not.toHaveBeenCalled();
	});
	it("clears on navigation, even after navigating back, and on unload", () => {
		const s = setup(); s.menu()[0].children[1].click();
		s.view.file = s.other; s.events.get("file-open")!(s.other);
		s.view.file = s.file;
		expect(s.plugin.getEffectiveView(s.view, s.file)?.name).toBe("Second");
		s.menu()[0].children[1].click(); s.disposers.forEach(fn => fn());
		expect(s.plugin.getEffectiveView(s.view, s.file)?.name).toBe("Second");
	});
	it("discards overrides for closed/replaced tabs and changed matching priority", () => {
		const s = setup(); s.menu()[0].children[1].click();
		s.plugin.settings.views.reverse();
		expect(s.plugin.getEffectiveView(s.view, s.file)?.name).toBe("Second");
		s.menu()[0].children[1].click(); s.leaves.splice(0, 1); s.events.get("layout-change")!();
		expect(s.menus.resolve(s.view, s.file)).toBeUndefined();
	});
	it("ignores stale menu actions after navigation or deletion", () => {
		const s = setup(); const items = s.menu();
		s.view.file = s.other; items.flatMap(item => [item, ...item.children]).forEach(item => item.click());
		expect(s.save).not.toHaveBeenCalled(); expect(s.edit).not.toHaveBeenCalled(); expect(s.refreshTab).not.toHaveBeenCalled();
		s.view.file = s.file; s.plugin.settings.views.shift(); items.flatMap(item => [item, ...item.children]).forEach(item => item.click());
		expect(s.save).not.toHaveBeenCalled();
	});
});
