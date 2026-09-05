import { describe, expect, it, vi } from "vitest";
import { App, type PluginManifest } from "obsidian";
import CustomViewsPlugin from "../main";
import { DEFAULT_SETTINGS } from "../settings";
import { loadValidatedSettings } from "../settings-loader";

const view = () => structuredClone(DEFAULT_SETTINGS.views[0]);
describe("malformed settings recovery", () => {
	it("preserves valid configurations, unknown fields, and intentional empty view lists", () => {
		const data = { ...structuredClone(DEFAULT_SETTINGS), views: [], futureOption: "keep" };
		expect(loadValidatedSettings(data)).toEqual({ settings: data, recovered: false });
	});
	it.each([undefined, null])("uses independent defaults for a new installation (%s)", data => {
		const loaded = loadValidatedSettings(data);
		expect(loaded.recovered).toBe(false);
		loaded.settings.views[0].name = "Changed";
		expect(DEFAULT_SETTINGS.views[0].name).toBe("View 1");
	});
	it.each([false, 42, "bad", [], { views: null }, { views: {} }])("opens safely with a malformed root or view list: %j", data => {
		const loaded = loadValidatedSettings(data);
		expect(loaded.recovered).toBe(true);
		expect(loaded.settings.views).toEqual([]);
		expect(loaded.settings.recoveryData).toEqual(data);
	});
	it("does not interpret a string false as permission to execute scripts", () => {
		const loaded = loadValidatedSettings({ allowJavaScript: "false", enabled: null, views: [] });
		expect(loaded.settings.allowJavaScript).toBe(false);
		expect(loaded.settings.enabled).toBe(false);
	});
	it.each([
		null, { template: "valuable template" },
		{ ...view(), rules: { type: "group", operator: "AND", conditions: [null] } },
		{ ...view(), rules: { type: "group", operator: "unknown", conditions: [] } },
		{ ...view(), rules: { type: "group", operator: "AND", conditions: [{ type: "filter", field: "x", operator: "unknown" }] } },
		{ ...view(), basesFilters: { and: null } },
		{ ...view(), css: 5 }, { ...view(), js: {} },
	])("quarantines invalid entries without losing good templates: %j", bad => {
		const good = { ...view(), id: "good", template: "User HTML", js: "User JS" };
		const data = { views: [bad, good] };
		const result = loadValidatedSettings(data);
		expect(result.settings.views).toEqual([good]);
		expect(result.settings.recoveryData).toEqual(data);
		expect(data.views).toEqual([bad, good]);
	});
	it("keeps duplicate IDs from making edits target the wrong view", () => {
		const data = { views: [view(), { ...view(), name: "Duplicate", template: "Keep this" }] };
		const result = loadValidatedSettings(data);
		expect(result.settings.views).toHaveLength(1);
		expect(result.settings.recoveryData).toEqual(data);
	});
	it("preserves both native and legacy filter semantics", () => {
		const data = { views: [
			{ ...view(), id: "native", basesFilters: { and: ["file.ext == 'md'", { not: ["false"] }] } },
			{ ...view(), id: "all", basesFilters: null },
			{ ...view(), id: "legacy", rules: { type: "group", operator: "NOR", conditions: [{ type: "filter", field: "tags", operator: "contains", value: "movie" }] } },
		] };
		const result = loadValidatedSettings(data);
		expect(result.recovered).toBe(false);
		expect(result.settings.views).toEqual(data.views);
	});
	it("does not overwrite disk on load and retains recovery data on later saves and reloads", async () => {
		const data = { views: [null, view()] };
		const plugin = new CustomViewsPlugin(new App(), {} as PluginManifest);
		const save = vi.fn(async () => {});
		Object.assign(plugin, { loadData: async () => data, saveData: save });
		await plugin.loadSettings();
		expect(save).not.toHaveBeenCalled();
		plugin.settings.views[0].name = "Edited";
		await plugin.saveSettings();
		expect(save).toHaveBeenCalledWith(expect.objectContaining({ recoveryData: data }));
		const reloaded = loadValidatedSettings(plugin.settings);
		expect(reloaded.recovered).toBe(false);
		expect(reloaded.settings.recoveryData).toEqual(data);
		expect(reloaded.settings.views[0].name).toBe("Edited");
	});
});
