/**
 * Tests for src/settings.ts
 *
 * Covers:
 *   - DEFAULT_SETTINGS shape and values
 *   - inferTemplatePropertyType — the function that guesses the property type
 *     from a frontmatter value
 */

import { describe, it, expect, vi } from "vitest";
import { DEFAULT_SETTINGS, CustomViewsSettingTab } from "../settings";

// ---------------------------------------------------------------------------
// DEFAULT_SETTINGS
// ---------------------------------------------------------------------------

describe("DEFAULT_SETTINGS", () => {
	it("has enabled: true by default", () => {
		expect(DEFAULT_SETTINGS.enabled).toBe(true);
	});

	it("has workInLivePreview: true by default", () => {
		expect(DEFAULT_SETTINGS.workInLivePreview).toBe(true);
	});

	it("has workInCanvas: false by default", () => {
		expect(DEFAULT_SETTINGS.workInCanvas).toBe(false);
	});

	it("has editableContent: true by default", () => {
		expect(DEFAULT_SETTINGS.editableContent).toBe(true);
	});

	it("has allowJavaScript: true by default", () => {
		expect(DEFAULT_SETTINGS.allowJavaScript).toBe(true);
	});

	it("has at least one default view", () => {
		expect(DEFAULT_SETTINGS.views.length).toBeGreaterThan(0);
	});

	it("every default view has the required fields", () => {
		for (const view of DEFAULT_SETTINGS.views) {
			expect(typeof view.id).toBe("string");
			expect(view.id.length).toBeGreaterThan(0);
			expect(typeof view.name).toBe("string");
			expect(view.name.length).toBeGreaterThan(0);
			expect(typeof view.template).toBe("string");
			expect(view.rules).toBeDefined();
			expect(view.rules.type).toBe("group");
			expect(["AND", "OR", "NOR"]).toContain(view.rules.operator);
			expect(Array.isArray(view.rules.conditions)).toBe(true);
		}
	});

	it("default views share no object references (deep-cloned rules)", () => {
		// Mutating one view's rules must not affect another
		const copy = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
		copy.views[0].rules.conditions.push({
			type: "filter",
			field: "test",
			operator: "is",
			value: "x",
		});
		// Original should be untouched
		expect(DEFAULT_SETTINGS.views[0].rules.conditions).not.toEqual(copy.views[0].rules.conditions);
	});
});

// ---------------------------------------------------------------------------
// inferTemplatePropertyType
//
// Template completion still infers types when Obsidian has no assigned type.
// ---------------------------------------------------------------------------

import { inferTemplatePropertyType as inferType } from "../template-properties";
import CustomViewsPlugin from "../main";

describe("inferTemplatePropertyType", () => {
	it("returns 'unknown' for null", () => expect(inferType(null)).toBe("unknown"));
	it("returns 'unknown' for undefined", () => expect(inferType(undefined)).toBe("unknown"));

	it("returns 'list' for an array", () => expect(inferType(["a", "b"])).toBe("list"));
	it("returns 'list' for an empty array", () => expect(inferType([])).toBe("list"));

	it("returns 'number' for a number", () => expect(inferType(42)).toBe("number"));
	it("returns 'number' for 0", () => expect(inferType(0)).toBe("number"));

	it("returns 'checkbox' for true", () => expect(inferType(true)).toBe("checkbox"));
	it("returns 'checkbox' for false", () => expect(inferType(false)).toBe("checkbox"));

	it("returns 'date' for a YYYY-MM-DD string", () => expect(inferType("2024-06-15")).toBe("date"));
	it("returns 'date' for start-of-range date", () => expect(inferType("2000-01-01")).toBe("date"));

	it("returns 'datetime' for a YYYY-MM-DDThh:mm string", () => expect(inferType("2024-06-15T14:30:00")).toBe("datetime"));
	it("returns 'datetime' for ISO string with Z", () => expect(inferType("2024-06-15T00:00:00Z")).toBe("datetime"));

	it("returns 'text' for a plain string", () => expect(inferType("hello")).toBe("text"));
	it("returns 'text' for a URL-like string", () => expect(inferType("https://example.com")).toBe("text"));
	it("returns 'text' for a numeric string (e.g. '42')", () => expect(inferType("42")).toBe("text"));
	it("returns 'text' for a wikilink string", () => expect(inferType("[[My Note]]")).toBe("text"));
});

// ---------------------------------------------------------------------------
// ViewConfig defaults
// ---------------------------------------------------------------------------

import type { ViewConfig } from "../types";

describe("ViewConfig optional fields", () => {
	it("default views do not set showProperties (defaults to undefined)", () => {
		for (const view of DEFAULT_SETTINGS.views) {
			expect(view.showProperties).toBeUndefined();
		}
	});

	it("default views do not set showInlineTitle (defaults to undefined)", () => {
		for (const view of DEFAULT_SETTINGS.views) {
			expect(view.showInlineTitle).toBeUndefined();
		}
	});

	it("default views do not set css (defaults to undefined)", () => {
		for (const view of DEFAULT_SETTINGS.views) {
			expect(view.css).toBeUndefined();
		}
	});

	it("default views do not set js (defaults to undefined)", () => {
		for (const view of DEFAULT_SETTINGS.views) {
			expect(view.js).toBeUndefined();
		}
	});

	it("showProperties=true means properties are shown (not hidden)", () => {
		const view: ViewConfig = {
			id: "test",
			name: "Test",
			rules: { type: "group", operator: "AND", conditions: [] },
			template: "<p>test</p>",
			showProperties: true,
		};
		// showProperties=true means show, showProperties=false means hide
		expect(view.showProperties).toBe(true);
	});

	it("showProperties=false means properties are hidden", () => {
		const view: ViewConfig = {
			id: "test",
			name: "Test",
			rules: { type: "group", operator: "AND", conditions: [] },
			template: "<p>test</p>",
			showProperties: false,
		};
		expect(view.showProperties).toBe(false);
	});
});


describe("view priority changes", () => {
	function setup() {
		const views = ["first", "second", "third"].map(id => ({ ...DEFAULT_SETTINGS.views[0], id }));
		const plugin = { settings: { views }, saveSettings: vi.fn(async () => {}), refreshAllViews: vi.fn() };
		const tab = new CustomViewsSettingTab({} as import("obsidian").App, plugin as unknown as CustomViewsPlugin);
		const update = vi.fn(); Object.assign(tab, { update });
		return { plugin, tab, update, reorder: (from: number, to: number) => (tab as unknown as { reorderViews(a: number, b: number): Promise<void> }).reorderViews(from, to) };
	}
	it("immediately reapplies first-match priority to open notes after saving", async () => {
		const { plugin, reorder } = setup();
		await reorder(1, 0);
		expect(plugin.settings.views.map(v => v.id)).toEqual(["second", "first", "third"]);
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(plugin.refreshAllViews).toHaveBeenCalledOnce();
	});
	it("refreshes the native list and open notes before a slow save finishes", async () => {
		const s = setup(); let finish!: () => void;
		s.plugin.saveSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
		const pending = s.reorder(1, 0);
		expect(s.update).toHaveBeenCalledOnce();
		expect(s.plugin.refreshAllViews).toHaveBeenCalledOnce();
		finish(); await pending;
	});
	it("ignores stale reorder callbacks and uses the new row order for deletion", async () => {
		const s = setup();
		const list = () => s.tab.getSettingDefinitions().find(item => "type" in item && item.type === "list") as { onReorder(from: number, to: number): void; onDelete(index: number): void };
		const previous = list(); previous.onReorder(1, 0);
		previous.onReorder(1, 0);
		expect(s.plugin.settings.views.map(v => v.id)).toEqual(["second", "first", "third"]);
		expect(s.plugin.saveSettings).toHaveBeenCalledOnce();
		list().onDelete(0); await Promise.resolve();
		expect(s.plugin.settings.views.map(v => v.id)).toEqual(["first", "third"]);
	});
	it("keeps the displayed list and priority consistent if persistence fails", async () => {
		const s = setup(); s.plugin.saveSettings.mockRejectedValueOnce(new Error("Disk full"));
		await expect(s.reorder(1, 0)).rejects.toThrow("Disk full");
		expect(s.plugin.settings.views.map(v => v.id)).toEqual(["second", "first", "third"]);
		expect(s.update).toHaveBeenCalledOnce();
		expect(s.plugin.refreshAllViews).toHaveBeenCalledOnce();
	});
	it.each([[0, -1], [2, 3], [-1, 0], [3, 0], [0, 0], [0.5, 1]])("ignores invalid or unchanged moves %s → %s", async (from, to) => {
		const { plugin, reorder } = setup();
		await reorder(from, to);
		expect(plugin.settings.views.map(v => v.id)).toEqual(["first", "second", "third"]);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(plugin.refreshAllViews).not.toHaveBeenCalled();
	});
});


describe("stable settings row identity", () => {
	it("uses unique IDs for views created in the same millisecond", () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1234);
		try {
			const tab = new CustomViewsSettingTab({} as import("obsidian").App, {} as CustomViewsPlugin);
			const create = () => (tab as unknown as { createNewView(): ViewConfig }).createNewView();
			expect(create().id).not.toBe(create().id);
		} finally { now.mockRestore(); }
	});
	it("keeps duplicate view names distinct when settings are reconciled", () => {
		const plugin = { settings: { ...DEFAULT_SETTINGS, views: [
			{ ...DEFAULT_SETTINGS.views[0], id: "one", name: "New View" },
			{ ...DEFAULT_SETTINGS.views[0], id: "two", name: "New View" },
		] } } as CustomViewsPlugin;
		const tab = new CustomViewsSettingTab({} as import("obsidian").App, plugin);
		const definition = tab.getSettingDefinitions().find(item => "type" in item && item.type === "list") as unknown as { items: { id: string; name: string }[] };
		expect(definition.items.map(item => item.id)).toEqual(["one", "two"]);
		expect(definition.items.map(item => item.name)).toEqual(["New View", "New View"]);
	});
});

describe("view deletion", () => {
	function setup() {
		const views = ["first", "second", "third"].map(id => ({ ...DEFAULT_SETTINGS.views[0], id }));
		const plugin = { settings: { ...DEFAULT_SETTINGS, views }, saveSettings: vi.fn(async () => {}), refreshAllViews: vi.fn() };
		const tab = new CustomViewsSettingTab({} as import("obsidian").App, plugin as unknown as CustomViewsPlugin);
		const update = vi.fn(); Object.assign(tab, { update });
		const definition = tab.getSettingDefinitions().find(item => "type" in item && item.type === "list") as unknown as { onDelete(index: number): void };
		return { plugin, definition, update };
	}
	it("removes the row and reapplies views while deletion is still saving", async () => {
		const s = setup(); let finish!: () => void;
		s.plugin.saveSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
		s.definition.onDelete(0);
		expect(s.update).toHaveBeenCalledOnce();
		expect(s.plugin.refreshAllViews).toHaveBeenCalledOnce();
		finish(); await Promise.resolve();
	});
	it("keeps the list and rendered priority consistent when a deletion save fails", async () => {
		const s = setup(); s.plugin.saveSettings.mockRejectedValueOnce(new Error("Disk full"));
		s.definition.onDelete(0); await Promise.resolve(); await Promise.resolve();
		expect(s.plugin.settings.views.map(view => view.id)).toEqual(["second", "third"]);
		expect(s.update).toHaveBeenCalledOnce();
		expect(s.plugin.refreshAllViews).toHaveBeenCalledOnce();
	});
	it("does not delete another view when the same row is clicked twice during a save", async () => {
		const s = setup(); let finish!: () => void;
		s.plugin.saveSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
		s.definition.onDelete(0); s.definition.onDelete(0);
		expect(s.plugin.settings.views.map(view => view.id)).toEqual(["second", "third"]);
		expect(s.plugin.saveSettings).toHaveBeenCalledOnce();
		finish(); await Promise.resolve(); await Promise.resolve();
	});
	it("deletes the displayed row's view after indices change", async () => {
		const s = setup(); s.plugin.settings.views.reverse();
		s.definition.onDelete(0);
		await Promise.resolve();
		expect(s.plugin.settings.views.map(view => view.id)).toEqual(["third", "second"]);
	});
	it.each([-1, 3, 0.5])("ignores invalid row index %s", index => {
		const s = setup(); s.definition.onDelete(index);
		expect(s.plugin.settings.views).toHaveLength(3);
		expect(s.plugin.saveSettings).not.toHaveBeenCalled();
	});
});


describe("fresh settings defaults", () => {
	it("does not share mutable default views between plugin loads", async () => {
		const create = async () => {
			const plugin = new CustomViewsPlugin({} as import("obsidian").App, {} as import("obsidian").PluginManifest);
			Object.assign(plugin, { loadData: async () => null });
			await plugin.loadSettings(); return plugin;
		};
		const first = await create();
		first.settings.views[0].name = "Changed";
		first.settings.views[0].rules.conditions.push({ type: "filter", field: "status", operator: "is", value: "done" });
		const second = await create();
		expect(second.settings.views[0].name).toBe("View 1");
		expect(second.settings.views[0].rules.conditions).toEqual([]);
		expect(DEFAULT_SETTINGS.views[0].name).toBe("View 1");
	});
});


describe("adding a view", () => {
	function setup() {
		const plugin = { settings: { ...DEFAULT_SETTINGS, views: [] as ViewConfig[] }, saveSettings: vi.fn(async () => {}) };
		const tab = new CustomViewsSettingTab({} as import("obsidian").App, plugin as unknown as CustomViewsPlugin);
		const update = vi.fn(); const open = vi.fn();
		Object.assign(tab, { update, openEditModal: open });
		const add = () => (tab as unknown as { addNewViewAndEdit(): Promise<void> }).addNewViewAndEdit();
		return { plugin, update, open, add };
	}
	it("opens the new view immediately while its save is pending", async () => {
		const s = setup(); let finish!: () => void;
		s.plugin.saveSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
		const pending = s.add();
		expect(s.plugin.settings.views).toHaveLength(1);
		expect(s.update).toHaveBeenCalledOnce();
		expect(s.open).toHaveBeenCalledWith(s.plugin.settings.views[0]);
		finish(); await pending;
		expect(s.open).toHaveBeenCalledOnce();
	});
	it("keeps the new view editable when persistence fails", async () => {
		const s = setup(); s.plugin.saveSettings.mockRejectedValueOnce(new Error("Disk full"));
		await expect(s.add()).rejects.toThrow("Disk full");
		expect(s.plugin.settings.views).toHaveLength(1);
		expect(s.update).toHaveBeenCalledOnce();
		expect(s.open).toHaveBeenCalledWith(s.plugin.settings.views[0]);
	});
});


describe("display setting changes", () => {
	function setup() {
		const plugin = { settings: { ...DEFAULT_SETTINGS }, saveSettings: vi.fn(async () => {}), refreshAllViews: vi.fn() };
		const tab = new CustomViewsSettingTab({} as import("obsidian").App, plugin as unknown as CustomViewsPlugin);
		const refreshDomState = vi.fn(); Object.assign(tab, { refreshDomState });
		return { plugin, tab, refreshDomState };
	}
	it.each(["workInLivePreview", "editableContent", "workInCanvas", "allowJavaScript"])("applies %s before its disk write finishes", async key => {
		const s = setup(); let finish!: () => void;
		s.plugin.saveSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
		const pending = s.tab.setControlValue(key, false);
		expect(Reflect.get(s.plugin.settings, key)).toBe(false);
		expect(s.plugin.refreshAllViews).toHaveBeenCalledOnce();
		if (key === "workInLivePreview") expect(s.refreshDomState).toHaveBeenCalledOnce();
		finish(); await pending;
		expect(s.plugin.refreshAllViews).toHaveBeenCalledOnce();
	});
	it("applies display changes even when saving fails", async () => {
		const s = setup(); s.plugin.saveSettings.mockRejectedValueOnce(new Error("Disk full"));
		await expect(s.tab.setControlValue("workInLivePreview", false)).rejects.toThrow("Disk full");
		expect(s.plugin.settings.workInLivePreview).toBe(false);
		expect(s.plugin.refreshAllViews).toHaveBeenCalledOnce();
		expect(s.refreshDomState).toHaveBeenCalledOnce();
	});
});
