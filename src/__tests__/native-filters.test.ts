import { describe, expect, it, vi } from "vitest";
import { App, TFile, Platform } from "obsidian";
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
			controller: { filterMenu: { globalFilterBuilder: builder, toolbarItem: { setOpen: vi.fn(), scrollEl: document.createElement("div"), button: { containerEl: document.createElement("div") } } }, buildBasesContext: vi.fn(() => ({})) },
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
	it("keeps the mobile builder in the native toolbar sheet and disposes both", async () => {
		const mobile = vi.spyOn(Platform, "isMobile", "get").mockReturnValue(true);
		try {
			const s = setup(); const api = await getNativeBasesApi(s.app);
			const parent = document.createElement("div"); const save = vi.fn();
			const dispose = api.createEditor(parent, "true", save);
			const { globalFilterBuilder: builder, toolbarItem: toolbar } = s.entries[1].controller.filterMenu;
			expect(parent.firstChild).toBe(toolbar.button.containerEl);
			expect(toolbar.scrollEl.firstChild).toBe(builder.innerContainerEl);
			const change = builder.updateQuery.mock.calls[0][0] as (filter: BasesFilter | null) => void;
			change({ and: ["rating > 3"] });
			expect(save).toHaveBeenCalledWith({ and: ["rating > 3"] });
			dispose();
			expect(toolbar.setOpen).toHaveBeenCalledWith(false);
			expect(parent.children).toHaveLength(0);
			expect(toolbar.scrollEl.children).toHaveLength(0);
		} finally { mobile.mockRestore(); }
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
	it("retries a failed native mount in place without saving or allocating duplicate controls", async () => {
		const s = setup(); const parent = window.document.createElement("div");
		const registry = (s.app as unknown as { embedRegistry: { embedByExtension: { base?: unknown } } }).embedRegistry.embedByExtension;
		delete registry.base;
		const config = view(); const save = vi.fn();
		const close = mountNativeFilters(s.app, parent, config, save);
		await vi.waitFor(() => expect(parent.querySelector('[role="alert"]')?.textContent).toContain("Enable"));
		const retry = parent.querySelector("button")!;
		expect(retry.textContent).toBe("Retry"); expect(retry.type).toBe("button");
		registry.base = s.factorySpy;
		retry.click(); retry.click();
		await vi.waitFor(() => expect(s.factorySpy).toHaveBeenCalledTimes(2));
		expect(parent.firstElementChild).toBe(s.entries[1].controller.filterMenu.globalFilterBuilder.innerContainerEl);
		retry.click(); await Promise.resolve();
		expect(s.factorySpy).toHaveBeenCalledTimes(2);
		expect(save).not.toHaveBeenCalled(); expect(config.basesFilters).toBeUndefined(); close();
	});
	it("ignores retained retry buttons and repeated disposal after the host is reused", async () => {
		const s = setup(); const parent = window.document.createElement("div");
		const registry = (s.app as unknown as { embedRegistry: { embedByExtension: { base?: unknown } } }).embedRegistry.embedByExtension;
		delete registry.base;
		const close = mountNativeFilters(s.app, parent, view(), vi.fn());
		await vi.waitFor(() => expect(parent.querySelector("button")).not.toBeNull());
		const retry = parent.querySelector("button")!;
		close(); parent.textContent = "New owner";
		registry.base = s.factorySpy;
		retry.click(); close(); await Promise.resolve();
		expect(parent.textContent).toBe("New owner"); expect(s.factorySpy).not.toHaveBeenCalled();
	});
	it("does not mount a pending retry after the dialog closes", async () => {
		const s = setup(); const parent = window.document.createElement("div");
		const registry = (s.app as unknown as { embedRegistry: { embedByExtension: { base?: unknown } } }).embedRegistry.embedByExtension;
		delete registry.base;
		const save = vi.fn(); const close = mountNativeFilters(s.app, parent, view(), save);
		await vi.waitFor(() => expect(parent.querySelector("button")).not.toBeNull());
		registry.base = s.factorySpy;
		parent.querySelector("button")!.click(); close();
		await getNativeBasesApi(s.app);
		expect(parent.children).toHaveLength(0); expect(s.factorySpy).toHaveBeenCalledOnce();
		expect(save).not.toHaveBeenCalled();
	});
	it("can retry discovery after Bases is enabled", async () => {
		const s = setup();
		const registry = (s.app as unknown as { embedRegistry: { embedByExtension: { base?: unknown } } }).embedRegistry.embedByExtension;
		delete registry.base;
		await expect(getNativeBasesApi(s.app)).rejects.toThrow("Enable");
		registry.base = s.factorySpy;
		await expect(getNativeBasesApi(s.app)).resolves.toBeDefined();
	});
	it.each([undefined, null, "rating > 3"])("skips disabled views and restores matching on enable (%s)", async filters => {
		const s = setup(); const engine = new NativeRuleEngine(s.app); await engine.prepare();
		const file = new TFile(); file.path = "match.md";
		const config = { ...view(null), basesFilters: filters, enabled: false };
		expect(engine.matches(config, file)).toBe(false);
		config.enabled = true;
		expect(engine.matches(config, file)).toBe(true);
		delete (config as ViewConfig).enabled;
		expect(engine.matches(config, file)).toBe(true);
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
	it("compiles a view once for a pass: parses once, ignores the enabled flag, and flags missing Bases", async () => {
		const s = setup(); const engine = new NativeRuleEngine(s.app);
		const file = new TFile(); file.path = "match.md";
		expect(engine.compile(view("rating > 3"))).toBeNull();
		expect(engine.compile(view(null))).toMatchObject({ all: true });
		expect(engine.compile({ ...view(null), basesFilters: { and: [] } })).toMatchObject({ all: true });
		expect(engine.compile({ ...view(null), basesFilters: undefined, rules: { type: "group", operator: "AND", conditions: [] } })).toMatchObject({ all: true });
		await engine.prepare();
		const rule = engine.compile({ ...view("rating > 3"), enabled: false })!;
		const parses = Query.parse.mock.calls.length;
		for (let i = 0; i < 50; i++) expect(rule.test(file)).toBe(true);
		expect(Query.parse.mock.calls.length).toBe(parses);
		expect(engine.compile(view("invalid"))!.test(file)).toBe(false);
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
		expect(convert({ type: "filter", field, operator: "is", value: "custom" })).toEqual({ and: [expect.stringContaining(`note[${JSON.stringify(field)}].toString() == "custom"`)] });
	});
	it("escapes property names and values rather than interpolating formula code", () => {
		const field = 'a"b'; const value = '"); true';
		expect(convert({ type: "filter", field, operator: "is", value })).toEqual({ and: [expect.stringContaining(`note[${JSON.stringify(field)}].toString() == ${JSON.stringify(value)}`)] });
	});
	it("preserves raw legacy link searches and nested conjunctions", () => {
		expect(toBasesFilter(app, { type: "group", operator: "NOR", conditions: [{ type: "group", operator: "OR", conditions: [{ type: "filter", field: "categories", operator: "contains any of", value: "[[Movies|Films]], [[Books]]" }] }] })).toEqual({ not: [{ or: ['if(note["categories"].isType("list"), note["categories"].filter(value.toString().split("[[Movies|Films]]").length > 1).length > 0, note["categories"].toString().split("[[Movies|Films]]").length > 1) || if(note["categories"].isType("list"), note["categories"].filter(value.toString().split("[[Books]]").length > 1).length > 0, note["categories"].toString().split("[[Books]]").length > 1)'] }] });
	});
	it("keeps the extension when converting legacy file.name", () => {
		expect(convert({ type: "filter", field: "file.name", operator: "is", value: "Movie.md" })).toEqual({ and: [expect.stringContaining('file.fullname.toString() == "Movie.md"')] });
	});
	it.each(["true", "false"])("uses boolean %s for explicitly assigned checkboxes", value => {
		const typedApp = { metadataTypeManager: { getAssignedWidget: () => "checkbox" } } as unknown as App;
		expect(toBasesFilter(typedApp, { type: "group", operator: "AND", conditions: [{ type: "filter", field: "done", operator: "is", value }] })).toEqual({ and: [expect.stringContaining(`note["done"] == ${value}`)] });
	});
	it("recognizes inferred checkbox widgets when there is no explicit assignment", () => {
		const typedApp = { metadataTypeManager: { getAssignedWidget: () => null, getAllProperties: () => ({ done: { name: "Done", widget: "checkbox" } }) } } as unknown as App;
		expect(toBasesFilter(typedApp, { type: "group", operator: "AND", conditions: [{ type: "filter", field: "done", operator: "is not", value: "false" }] })).toEqual({ and: [expect.stringMatching(/^!\(.*note\["done"\] == false/)] });
	});
	it("preserves text true and false for non-checkbox properties", () => {
		const typedApp = { metadataTypeManager: { getAssignedWidget: () => "text" } } as unknown as App;
		expect(toBasesFilter(typedApp, { type: "group", operator: "AND", conditions: [{ type: "filter", field: "status", operator: "is", value: "true" }] })).toEqual({ and: [expect.stringContaining('note["status"].toString() == "true"')] });
	});
	it.each(["is exactly", "is not exactly"] as const)("preserves order-independent list comparison for %s", operator => {
		const op = operator === "is exactly" ? "==" : "!=";
		expect(convert({ type: "filter", field: "items", operator, value: "b, a, a" })).toEqual({ and: [`if(note["items"].isType("list"), note["items"].map(value.toString()).sort() ${op} ["b", "a", "a"].sort(), false)`] });
	});
	it("keeps raw link spelling and aliases in exact legacy comparisons", () => {
		expect(convert({ type: "filter", field: "items", operator: "is exactly", value: "[[Movies|Films]]" })).toEqual({ and: ['if(note["items"].isType("list"), note["items"].map(value.toString()).sort() == ["[[Movies|Films]]"].sort(), false)'] });
	});
	it.each(["contains any of", "contains all of"] as const)("keeps an empty %s search from matching every note", operator => {
		expect(convert({ type: "filter", field: "items", operator, value: " , " })).toEqual({ and: ["false"] });
	});
	it.each(["does not contain any of", "does not contain all of"] as const)("preserves empty negated %s searches", operator => {
		expect(convert({ type: "filter", field: "items", operator, value: "" })).toEqual({ and: ["!(false)"] });
	});
	it("converts partial list searches and scalar searches to string containment", () => {
		expect(convert({ type: "filter", field: "items", operator: "contains", value: "fiction" })).toEqual({ and: ['if(note["items"].isType("list"), note["items"].filter(value.toString().split("fiction").length > 1).length > 0, note["items"].toString().split("fiction").length > 1)'] });
	});
	it("keeps a single empty substring search distinct from an empty any/all search", () => {
		expect(convert({ type: "filter", field: "items", operator: "contains", value: "" })).toEqual({ and: ['if(note["items"].isType("list"), note["items"].length > 0, true)'] });
	});
	it.each(["is", "is not"] as const)("preserves list membership and missing-value equality for %s", operator => {
		const match = 'if(note["items"].isType("list"), note["items"].map(value.toString()).contains(""), if(note["items"] == null, true, note["items"].toString() == ""))';
		expect(convert({ type: "filter", field: "items", operator, value: "" })).toEqual({ and: [operator === "is" ? match : `!(${match})`] });
	});
	it("uses literal case-sensitive substring matching", () => {
		expect(convert({ type: "filter", field: "items", operator: "contains", value: "F.*" })).toEqual({ and: ['if(note["items"].isType("list"), note["items"].filter(value.toString().split("F.*").length > 1).length > 0, note["items"].toString().split("F.*").length > 1)'] });
	});
	it.each([
		["starts with", 'if(note["items"].isType("list"), false, if(note["items"] == null, "", note["items"].toString()).slice(0, 2) == "Ab")'],
		["does not start with", 'if(note["items"].isType("list"), false, !(if(note["items"] == null, "", note["items"].toString()).slice(0, 2) == "Ab"))'],
		["ends with", 'if(note["items"].isType("list"), false, if(note["items"] == null, "", note["items"].toString()).slice(-2) == "Ab")'],
		["does not end with", 'if(note["items"].isType("list"), false, !(if(note["items"] == null, "", note["items"].toString()).slice(-2) == "Ab"))'],
	] as const)("converts %s without case folding or matching lists", (operator, formula) => {
		expect(convert({ type: "filter", field: "items", operator, value: "Ab" })).toEqual({ and: [formula] });
	});
	it("preserves an empty suffix without treating negative zero as the whole string", () => {
		expect(convert({ type: "filter", field: "items", operator: "ends with", value: "" })).toEqual({ and: ['if(note["items"].isType("list"), false, true)'] });
	});
	it.each(["is empty", "is not empty"] as const)("supports %s on lists, missing values, and scalar booleans", operator => {
		const match = 'if(note["items"].isType("list"), note["items"].length == 0, note["items"] == null || note["items"].toString() == "")';
		expect(convert({ type: "filter", field: "items", operator })).toEqual({ and: [operator === "is empty" ? match : `!(${match})`] });
	});
	it.each(["=", "≠", "<", "≤", ">", "≥"] as const)("guards invalid operands for numeric %s", operator => {
		const result = convert({ type: "filter", field: "rating", operator, value: "2" });
		expect(result).toEqual({ and: [expect.stringContaining('note["rating"] != null && !note["rating"].isType("boolean") && !note["rating"].isType("list")')] });
		expect(result).toEqual({ and: [expect.stringContaining('note["rating"] > -number("Infinity") && note["rating"] < number("Infinity")')] });
	});
	it.each(["1e21", "1e-7"])("emits parser-compatible scientific notation for %s", value => {
		expect(convert({ type: "filter", field: "rating", operator: "=", value })).toEqual({ and: [expect.stringContaining(`note["rating"] == number(${JSON.stringify(String(Number(value)))})`)] });
	});
	it.each(["", " ", "bad", "Infinity", "-Infinity", "1e999"])("does not convert invalid numeric input %j into a matching condition", value => {
		expect(convert({ type: "filter", field: "rating", operator: "≠", value })).toEqual({ and: ["false"] });
	});
	it("converts numeric symbols without quoting numbers", () => {
		expect(convert({ type: "filter", field: "rating", operator: "≥", value: "3.5" })).toEqual({ and: [expect.stringContaining('note["rating"] >= 3.5')] });
	});
});

describe("native Bases integration on Obsidian 1.15+", () => {
	function setup115() {
		vi.stubGlobal("activeDocument", window.document);
		const entries: { filterMenu: { filterEditor: { updateQuery: ReturnType<typeof vi.fn> }; baseSection: { innerEl: HTMLElement; root: { children: unknown[] } }; createPage(host: unknown): { containerEl: HTMLElement }; toolbarItem: { setOpen: ReturnType<typeof vi.fn>; containerEl: HTMLElement; button: { setText(text: string): void } } } }[] = [];
		const factory = vi.fn(() => {
			const filterMenu = {
				filterEditor: { updateQuery: vi.fn() },
				baseSection: { innerEl: document.createElement("div"), root: { children: [] } },
				viewSectionEl: document.createElement("div"),
				createPage(this: { viewSectionEl: HTMLElement }) { const containerEl = document.createElement("div"); containerEl.append(this.viewSectionEl); return { containerEl }; },
				toolbarItem: { setOpen: vi.fn(), containerEl: document.createElement("div"), button: { setText: vi.fn() } },
			};
			entries.push({ filterMenu });
			return { controller: { filterMenu, buildBasesContext: () => ({}) }, loadQuery: async () => new Query(), unload: vi.fn() };
		});
		return { app: { embedRegistry: { embedByExtension: { base: factory } } } as unknown as App, entries };
	}
	it("mounts only the global section and saves only global filters", async () => {
		const s = setup115(); const api = await getNativeBasesApi(s.app);
		const parent = document.createElement("div"); const save = vi.fn();
		api.createEditor(parent, "true", save);
		const menu = s.entries[1].filterMenu;
		expect(parent.firstChild).toBe(menu.baseSection.innerEl);
		const [callback, filters] = menu.filterEditor.updateQuery.mock.calls[0] as [(f: (BasesFilter | null)[]) => void, unknown[]];
		expect(filters).toHaveLength(2); expect(filters[1]).toBeNull();
		callback([{ and: ["rating > 3"] }, "ignored"]);
		expect(save).toHaveBeenCalledWith({ and: ["rating > 3"] });
	});
	it("shows only the global section in the popover page", async () => {
		const s = setup115(); const api = await getNativeBasesApi(s.app);
		const parent = document.createElement("div");
		const error = vi.spyOn(console, "error");
		const dispose = api.createEditor(parent, "true", vi.fn(), true);
		const menu = s.entries[1].filterMenu;
		expect(parent.firstChild).toBe(menu.toolbarItem.containerEl);
		const page = menu.createPage({});
		expect([...page.containerEl.children]).toEqual([menu.baseSection.innerEl]);
		dispose();
		expect(menu.toolbarItem.setOpen).toHaveBeenCalledWith(false);
		expect(parent.children).toHaveLength(0);
		expect(error).not.toHaveBeenCalled();
	});
});
