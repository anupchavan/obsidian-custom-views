import { describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import { getNativeBasesApi, type BasesFilter } from "../native-filters/api";
import { toBasesFilter } from "../native-filters/convert";
import { mountNativeFilters } from "../native-filters/editor";
import { NativeRuleEngine } from "../native-filters/engine";
import type { Filter, ViewConfig } from "../types";

vi.mock("obsidian", async original => ({
	...await original<typeof import("obsidian")>(),
	BasesEntry: class { constructor(public ctx: unknown, public file: TFile) {} },
}));

class Query {
	views = [{ name: "Rules" }];
	saveFn = vi.fn();
	filters?: { serialize(): BasesFilter; hasError(): boolean; test(entry: { file: TFile }): boolean };
	static parse = vi.fn((data: { filters?: BasesFilter }) => {
		if (data.filters === "throw") throw new Error("Invalid query");
		const q = new Query();
		if (data.filters !== undefined) q.filters = {
			serialize: () => data.filters!, hasError: () => data.filters === "invalid",
			test: entry => entry.file.path === "match.md",
		};
		return q;
	});
	getViewConfig() { return this.views[0]; }
	setGlobalFilters(filters: BasesFilter | null) { this.filters = Query.parse(filters === null ? {} : { filters }).filters; this.saveFn(); }
}

function setup() {
	vi.stubGlobal("activeDocument", window.document);
	const entries: ReturnType<typeof createEmbed>[] = [];
	function createEmbed() {
		const innerContainerEl = window.document.createElement("div");
		const editor = { destroy: vi.fn() };
		const builder = { innerContainerEl, root: { children: [{ advancedInputEditor: editor, leftInputEl: { close: vi.fn() }, operatorComponent: { close: vi.fn() } }] }, updateQuery: vi.fn<(...args: unknown[]) => void>() };
		const embed = {
			controller: { filterMenu: { globalFilterBuilder: builder, toolbarItem: { setOpen: vi.fn() } }, buildBasesContext: vi.fn(() => ({})) },
			loadQuery: vi.fn(async function (this: { app: { vault: { read(): Promise<string> } } }) {
				expect(await this.app.vault.read()).toBe("");
				return new Query();
			}),
			unload: vi.fn(),
		};
		return embed;
	}
	const read = vi.fn(() => { throw new Error("Must not read a vault file"); });
	const create = vi.fn(); const modify = vi.fn();
	const factorySpy = vi.fn(() => { const embed = createEmbed(); entries.push(embed); return embed; });
	const app = { vault: { read, create, modify }, embedRegistry: { embedByExtension: { base: factorySpy } } } as unknown as App;
	return { app, entries, read, create, modify, factorySpy };
}
const view = (basesFilters?: BasesFilter | null): ViewConfig => ({
	id: "test", name: "Test", rules: { type: "group", operator: "AND", conditions: [] }, template: "", basesFilters,
});

describe("native Bases integration", () => {
	it("discovers once, without reading, creating, modifying, or patching vault files", async () => {
		const s = setup();
		const originalRead = s.read;
		const [one, two] = await Promise.all([getNativeBasesApi(s.app), getNativeBasesApi(s.app)]);
		expect(one).toBe(two); expect(s.factorySpy).toHaveBeenCalledTimes(1);
		expect(s.entries[0].unload).toHaveBeenCalledOnce();
		expect(Reflect.get(s.app.vault, "read")).toBe(originalRead);
		for (const operation of [s.read, s.create, s.modify]) expect(operation).not.toHaveBeenCalled();
	});
	it("mounts the real builder and routes serialized changes to settings", async () => {
		const s = setup(); const api = await getNativeBasesApi(s.app);
		const parent = window.document.createElement("div"); const save = vi.fn();
		const dispose = api.createEditor(parent, "true", save);
		const builder = s.entries[1].controller.filterMenu.globalFilterBuilder;
		expect(parent.firstChild).toBe(builder.innerContainerEl);
		const callback = builder.updateQuery.mock.calls[0][0] as (filter: BasesFilter | null) => void;
		callback({ or: ["file.inFolder(\"Movies\")", "rating > 3"] });
		expect(save).toHaveBeenCalledWith({ or: ["file.inFolder(\"Movies\")", "rating > 3"] });
		expect(s.modify).not.toHaveBeenCalled();
		const destroy = builder.root.children[0].advancedInputEditor.destroy;
		dispose(); dispose();
		expect(builder.root.children[0].leftInputEl.close).toHaveBeenCalledOnce();
		expect(builder.root.children[0].operatorComponent.close).toHaveBeenCalledOnce();
		expect(parent.children).toHaveLength(0); expect(destroy).toHaveBeenCalledOnce();
		expect(s.entries[1].unload).toHaveBeenCalledOnce();
	});
	it.each(["toolbar", "property", "operator", "formula", "embed"])("cleans up remaining native resources when %s cleanup throws", async failing => {
		const s = setup(); const api = await getNativeBasesApi(s.app);
		const parent = window.document.createElement("div"); const save = vi.fn();
		const dispose = api.createEditor(parent, "true", save);
		const embed = s.entries[1]; const builder = embed.controller.filterMenu.globalFilterBuilder;
		const row = builder.root.children[0];
		const cleanups = { toolbar: embed.controller.filterMenu.toolbarItem.setOpen, property: row.leftInputEl.close, operator: row.operatorComponent.close, formula: row.advancedInputEditor.destroy, embed: embed.unload };
		const error = new Error("Native control failed to close");
		cleanups[failing as keyof typeof cleanups].mockImplementation(() => { throw error; });
		const report = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(dispose).not.toThrow(); dispose();
			for (const close of Object.values(cleanups)) expect(close).toHaveBeenCalledOnce();
			expect(parent.children).toHaveLength(0);
			const callback = builder.updateQuery.mock.calls[0][0] as (filter: BasesFilter | null) => void;
			callback("false"); expect(save).not.toHaveBeenCalled();
			expect(report).toHaveBeenCalledWith("[Custom Views] Could not clean up a native filter control:", error);
		} finally { report.mockRestore(); }
	});
	it("unloads a later embed if its filter menu is unavailable", async () => {
		const s = setup(); const api = await getNativeBasesApi(s.app);
		const factory = s.factorySpy.getMockImplementation()!;
		s.factorySpy.mockImplementationOnce(() => {
			const embed = factory(); Reflect.deleteProperty(embed.controller, "filterMenu"); return embed;
		});
		expect(() => api.createEditor(window.document.createElement("div"), null, vi.fn())).toThrow("compatible Bases filter editor");
		expect(s.entries[1].unload).toHaveBeenCalledOnce();
	});
	it("does not allocate an editor for an unparseable saved query", async () => {
		const s = setup(); const api = await getNativeBasesApi(s.app);
		expect(() => api.createEditor(window.document.createElement("div"), "throw", vi.fn())).toThrow();
		expect(s.factorySpy).toHaveBeenCalledTimes(1);
	});
	it("unloads the native embed when context initialization fails", async () => {
		const s = setup(); const api = await getNativeBasesApi(s.app);
		const factory = s.factorySpy.getMockImplementation()!;
		s.factorySpy.mockImplementationOnce(() => {
			const embed = factory();
			embed.controller.buildBasesContext.mockImplementation(() => { throw new Error("Missing formula context"); });
			return embed;
		});
		expect(() => api.createEditor(window.document.createElement("div"), "true", vi.fn())).toThrow("Missing formula context");
		expect(s.entries[1].unload).toHaveBeenCalledOnce();
	});
	it("does not remount or mutate settings after a modal closes during initialization", async () => {
		const s = setup(); const parent = window.document.createElement("div");
		const config = view(); const save = vi.fn();
		const close = mountNativeFilters(s.app, parent, config, save); close();
		await getNativeBasesApi(s.app);
		expect(parent.children).toHaveLength(0); expect(s.factorySpy).toHaveBeenCalledTimes(1);
		expect(save).not.toHaveBeenCalled(); expect(config.basesFilters).toBeUndefined();
	});
	it("does not rewrite legacy filters just from opening the editor", async () => {
		const s = setup(); const parent = window.document.createElement("div");
		const config = view(); const save = vi.fn();
		const close = mountNativeFilters(s.app, parent, config, save);
		await getNativeBasesApi(s.app);
		expect(config.basesFilters).toBeUndefined(); expect(save).not.toHaveBeenCalled(); close();
	});
	it("can retry discovery after Bases is enabled", async () => {
		const s = setup();
		const registry = (s.app as unknown as { embedRegistry: { embedByExtension: { base?: unknown } } }).embedRegistry.embedByExtension;
		delete registry.base;
		await expect(getNativeBasesApi(s.app)).rejects.toThrow("Enable");
		registry.base = s.factorySpy;
		await expect(getNativeBasesApi(s.app)).resolves.toBeDefined();
	});
	it("evaluates native rules on fresh file entries and rejects invalid formulas", async () => {
		const s = setup(); const engine = new NativeRuleEngine(s.app); await engine.prepare();
		const yes = new TFile(); yes.path = "match.md"; const no = new TFile(); no.path = "other.md";
		expect(engine.matches(view("rating > 3"), yes)).toBe(true);
		expect(engine.matches(view("rating > 3"), no)).toBe(false);
		expect(engine.matches(view("invalid"), yes)).toBe(false);
		expect(engine.matches(view("throw"), yes)).toBe(false);
		expect(engine.matches(view(null), no)).toBe(true);
	});
	it("recovers matching and refreshes views after Bases is enabled without reloading the plugin", async () => {
		const s = setup(); const ready = vi.fn(); const engine = new NativeRuleEngine(s.app, ready);
		const registry = (s.app as unknown as { embedRegistry: { embedByExtension: { base?: unknown } } }).embedRegistry.embedByExtension;
		delete registry.base;
		await expect(engine.prepare()).rejects.toThrow("Enable");
		const file = new TFile(); file.path = "match.md";
		expect(engine.matches(view("true"), file)).toBe(false);
		await new Promise(resolve => window.setTimeout(resolve, 0));
		expect(ready).not.toHaveBeenCalled();
		registry.base = s.factorySpy;
		expect(engine.matches(view("true"), file)).toBe(false);
		expect(engine.matches(view("true"), file)).toBe(false);
		await new Promise(resolve => window.setTimeout(resolve, 0));
		expect(ready).toHaveBeenCalledOnce();
		expect(engine.matches(view("true"), file)).toBe(true);
		expect(s.factorySpy).toHaveBeenCalledOnce();
	});
});

describe("legacy filter conversion", () => {
	const app = {} as App;
	const convert = (condition: Filter) => toBasesFilter(app, { type: "group", operator: "AND", conditions: [condition] });
	it.each(["constructor", "toString", "__proto__"])("preserves the property %s when opening native filters", field => {
		expect(convert({ type: "filter", field, operator: "is", value: "custom" })).toEqual({ and: [`note[${JSON.stringify(field)}] == "custom"`] });
	});
	it("escapes property names and values rather than interpolating formula code", () => {
		expect(convert({ type: "filter", field: 'a"b', operator: "is", value: '"); true' })).toEqual({ and: ['note["a\\"b"] == "\\"); true"'] });
	});
	it("preserves wikilinks as native link values and nested conjunctions", () => {
		expect(toBasesFilter(app, { type: "group", operator: "NOR", conditions: [{ type: "group", operator: "OR", conditions: [{ type: "filter", field: "categories", operator: "contains any of", value: "[[Movies|Films]], [[Books]]" }] }] })).toEqual({ not: [{ or: ['note["categories"].containsAny(link("Movies"), link("Books"))'] }] });
	});
	it("keeps the extension when converting legacy file.name", () => {
		expect(convert({ type: "filter", field: "file.name", operator: "is", value: "Movie.md" })).toEqual({ and: ['file.fullname == "Movie.md"'] });
	});
	it("converts numeric symbols without quoting numbers", () => {
		expect(convert({ type: "filter", field: "rating", operator: "≥", value: "3.5" })).toEqual({ and: ['note["rating"] >= 3.5'] });
	});
});
