import { describe, expect, it, vi } from "vitest";
import { MarkdownView, TFile, WorkspaceLeaf, type FuzzyMatch } from "obsidian";
import { ViewEditor, ViewEditorPicker, VIEW_EDITOR_TYPE, registerViewEditor, openViewEditorTab } from "../view-editor";
import type CustomViewsPlugin from "../main";
import type { ViewConfig } from "../types";

vi.mock("../view-editor-workbench", async importOriginal => {
 const actual = await importOriginal<typeof import("../view-editor-workbench")>();
 return { ...actual, EditorWorkbench: vi.fn(class {
   dispose = vi.fn();
   getContext = () => this.context;
   constructor(_plugin: unknown, _host: unknown, _view: unknown, private context: string) {}
 }) };
});

function setup(hasNote = true) {
	const views = [{ id: "a", name: "Movies", enabled: false }, { id: "b", name: "People" }] as ViewConfig[];
	const lifetime = new AbortController();
	const leaves: { setViewState: ReturnType<typeof vi.fn> }[] = [];
	const workspace = {
		getActiveViewOfType: vi.fn(() => hasNote ? Object.assign(new MarkdownView({} as WorkspaceLeaf), { file: new TFile() }) : null),
		getLeaf: vi.fn(() => {
			const leaf = { setViewState: vi.fn().mockResolvedValue(undefined) }; leaves.push(leaf); return leaf;
		}),
		revealLeaf: vi.fn().mockResolvedValue(undefined),
	};
	const findMatchingView = vi.fn(() => views[0]);
	const registerView = vi.fn(); const addCommand = vi.fn();
	const saveSettings = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
	const plugin = { app: { workspace }, settings: { views }, unloadSignal: lifetime.signal,
		findMatchingView, registerView, addCommand, saveSettings,
	} as unknown as CustomViewsPlugin;
	return { plugin, saveSettings, views, lifetime, workspace, leaves, findMatchingView, registerView, addCommand };
}

describe("view editor shell", () => {
	it("registers an always-available command and workspace view factory", () => {
		const s = setup(); registerViewEditor(s.plugin);
		expect(s.addCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "open-view-editor", name: "Open view editor", callback: expect.any(Function) }));
		expect(s.registerView).toHaveBeenCalledWith(VIEW_EDITOR_TYPE, expect.any(Function));
	});
	it("lists disabled views too, and uses the native badge for the current note match", () => {
		const s = setup(); const picker = new ViewEditorPicker(s.plugin);
		expect(picker.getItems()).toEqual(s.views);
		expect(s.findMatchingView).toHaveBeenCalledWith(expect.any(TFile), true);
		for (const [index, view] of s.views.entries()) {
			const el = document.createElement("div");
			picker.renderSuggestion({ item: view } as FuzzyMatch<ViewConfig>, el);
			expect(el.querySelector(".flair.mod-pop")?.textContent).toBe(index === 0 ? "Current note" : undefined);
		}
	});
	it("does not label a stale note when a non-note tab is active", () => {
		const s = setup(false); const picker = new ViewEditorPicker(s.plugin);
		const el = document.createElement("div");
		picker.renderSuggestion({ item: s.views[0] } as FuzzyMatch<ViewConfig>, el);
		expect(el.querySelector(".flair")).toBeNull();
		expect(s.findMatchingView).not.toHaveBeenCalled();
	});
	it("opens a new tab per selection with the selected ID, without modifying views", async () => {
		const s = setup(); const saved = structuredClone(s.views); const picker = new ViewEditorPicker(s.plugin);
		picker.onChooseItem(s.views[0]); picker.onChooseItem(s.views[1]);
		await vi.waitFor(() => expect(s.workspace.revealLeaf).toHaveBeenCalledTimes(2));
		expect(s.workspace.getLeaf).toHaveBeenNthCalledWith(1, "tab");
		expect(s.leaves[0].setViewState).toHaveBeenCalledWith({ type: VIEW_EDITOR_TYPE, active: true, state: { viewId: "a" } });
		expect(s.leaves[1].setViewState).toHaveBeenCalledWith({ type: VIEW_EDITOR_TYPE, active: true, state: { viewId: "b" } });
		expect(s.views).toEqual(saved);
	});
	it("opens a selected template context directly without the picker", async () => {
		const s = setup();
		await openViewEditorTab(s.plugin, s.views[0], "canvas");
		expect(s.leaves[0].setViewState).toHaveBeenCalledWith({ type: VIEW_EDITOR_TYPE, active: true, state: { viewId: "a", context: "canvas" } });
		const editor = new ViewEditor(new WorkspaceLeaf(), s.plugin);
		await editor.setState({ viewId: "a", context: "canvas" }, { history: false });
		expect(editor.getState()).toMatchObject({ viewId: "a", context: "canvas", layout: { dock: "right" } });
	});

	it("ignores removed views and closes the picker on plugin unload", async () => {
		const s = setup(); const picker = new ViewEditorPicker(s.plugin); const close = vi.spyOn(picker, "close");
		await picker.onOpen(); const removed = s.views.shift()!; picker.onChooseItem(removed);
		expect(s.workspace.getLeaf).not.toHaveBeenCalled();
		s.lifetime.abort(); expect(close).toHaveBeenCalledOnce();
		picker.onChooseItem(s.views[0]); expect(s.workspace.getLeaf).not.toHaveBeenCalled();
	});
	it("restores the selected ID and initializes its workbench state", async () => {
		const s = setup(); const editor = new ViewEditor(new WorkspaceLeaf(), s.plugin);
		await editor.setState({ viewId: "a" }, { history: false });
		await editor.onOpen();
		expect(editor.getState()).toMatchObject({ viewId: "a", layout: { visible: ["template", "css", "js"] } });
		expect(editor.getDisplayText()).toBe("Edit Movies");
		expect(editor.contentEl.childNodes).toHaveLength(0);
		await editor.setState(null, { history: false }); expect(editor.getDisplayText()).toBe("View editor");
	});
});


describe("create from the view picker", () => {
 it("offers a create result for an unmatched name and saves before opening", async () => {
  const s = setup(), picker = new ViewEditorPicker(s.plugin);
  const matches = picker.getSuggestions("  Recipes  ");
  expect(matches).toHaveLength(1); expect(matches[0].item.name).toBe("Recipes");
  expect(s.views).toHaveLength(2);
  picker.onChooseItem(matches[0].item);
  await vi.waitFor(() => expect(s.workspace.revealLeaf).toHaveBeenCalledOnce());
  expect(s.saveSettings).toHaveBeenCalledOnce();
  expect(s.views[2]).toMatchObject({ name: "Recipes", rules: { type: "group", operator: "AND", conditions: [] } });
  expect(s.leaves[0].setViewState).toHaveBeenCalledWith(expect.objectContaining({ state: { viewId: s.views[2].id } }));
 });
 it("keeps matching results as existing views", () => {
  const s = setup(), picker = new ViewEditorPicker(s.plugin);
  expect(picker.getSuggestions("Movie")[0].item).toBe(s.views[0]);
  expect(picker.getSuggestions("")).toHaveLength(2);
 });
 it("creates from Shift+Enter even when the query partially matches an existing view", async () => {
  const s = setup(), picker = new ViewEditorPicker(s.plugin);
  picker.inputEl.value = "Movie";
  const scope = picker.scope as unknown as { keys: { modifiers: string[]; key: string; func: (event: KeyboardEvent) => unknown }[] };
  const create = scope.keys.find(key => key.modifiers.includes("Shift") && key.key === "Enter")!;
  create.func(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }));
  await vi.waitFor(() => expect(s.workspace.revealLeaf).toHaveBeenCalledOnce());
  expect(s.views[2].name).toBe("Movie");
 });
 it("does not create duplicate names or create during IME composition", async () => {
  const s = setup(), picker = new ViewEditorPicker(s.plugin);
  const scope = picker.scope as unknown as { keys: { func: (event: KeyboardEvent) => unknown }[] };
  picker.inputEl.value = "movies"; scope.keys[0].func(new KeyboardEvent("keydown"));
  picker.inputEl.value = "Different"; scope.keys[0].func(new KeyboardEvent("keydown", { isComposing: true }));
  await Promise.resolve(); expect(s.saveSettings).not.toHaveBeenCalled(); expect(s.views).toHaveLength(2);
 });
 it("rolls back failed creation and ignores repeated input while saving", async () => {
  const s = setup(), picker = new ViewEditorPicker(s.plugin);
  let reject!: (error: Error) => void;
  vi.mocked(s.saveSettings).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const result = picker.getSuggestions("Unsaved")[0].item;
  picker.onChooseItem(result); picker.onChooseItem(result);
  expect(s.saveSettings).toHaveBeenCalledOnce();
  reject(new Error("disk failure")); await vi.waitFor(() => expect(s.views).toHaveLength(2));
  expect(s.workspace.getLeaf).not.toHaveBeenCalled();
 });
});
