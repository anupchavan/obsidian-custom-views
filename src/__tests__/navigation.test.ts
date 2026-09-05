import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { App, MarkdownView, TFile, type PluginManifest, type WorkspaceLeaf } from "obsidian";
import CustomViewsPlugin from "../main";
import { DEFAULT_SETTINGS } from "../settings";
import { getTemplateDependencies, renderTemplate, EDITABLE_PLACEHOLDER_ATTR } from "../renderer";
import type { ViewConfig } from "../types";

vi.mock("../renderer", async (original) => ({
	...await original<typeof import("../renderer")>(),
	renderTemplate: vi.fn(),
	getTemplateDependencies: vi.fn(),
}));

const editors: EditorView[] = [];
afterEach(() => { vi.useRealTimers(); editors.splice(0).forEach(editor => editor.destroy()); vi.clearAllMocks(); });
function setup() {
	const container = window.document.createElement("div");
	const originalParent = container.appendChild(window.document.createElement("div"));
	const editorEl = originalParent.appendChild(window.document.createElement("div"));
	editorEl.className = "markdown-source-view";
	const cm = new EditorView({ state: EditorState.create({ doc: "Note body" }), parent: editorEl });
	editors.push(cm);
	const file = new TFile(); file.path = "Movies/First.md";
	const view = Object.assign(new MarkdownView({} as WorkspaceLeaf), {
		contentEl: container, file, editor: { cm }, getState: () => ({ mode: "source", source: false }), getViewData: () => "Note body",
	});
	const plugin = new CustomViewsPlugin({} as App, {} as PluginManifest);
	plugin.app = {} as App;
	plugin.settings = { ...DEFAULT_SETTINGS };
	Object.assign(plugin, { registerDomEvent: (el: HTMLElement, type: string, fn: EventListener) => el.addEventListener(type, fn) });
	const methods = plugin as unknown as {
		injectEditableView(view: MarkdownView, file: TFile, config: ViewConfig): Promise<void>;
		restoreEditableView(view: MarkdownView): void;
		_processLeaf(view: MarkdownView, file: TFile): Promise<void>;
		queueNoteRefresh(file: TFile): void;
	};
	const config = { id: "test", template: "{{content}}" } as ViewConfig;
	vi.mocked(renderTemplate).mockImplementation(async (_app, _template, _file, el) => {
		const placeholder = el.ownerDocument.createElement("div");
		placeholder.setAttribute(EDITABLE_PLACEHOLDER_ATTR, "true");
		el.appendChild(placeholder);
	});
	// Obsidian's DOM helpers are installed by the host in production.
	Object.assign(window.HTMLElement.prototype, {
		addClass(...names: string[]) { (this as HTMLElement).classList.add(...names); },
		removeClass(...names: string[]) { (this as HTMLElement).classList.remove(...names); },
		toggleClass(name: string, value: boolean) { (this as HTMLElement).classList.toggle(name, value); },
	});
	const metadata = { frontmatter: { title: "First" } };
	plugin.app = { metadataCache: { getFileCache: () => metadata }, workspace: {
		iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => callback({ view }),
	} } as unknown as App;
	plugin.settings.views = [config];
	plugin.settings.enabled = true;
	plugin.settings.workInLivePreview = true;
	plugin.settings.editableContent = true;
	Object.assign(plugin, { nativeRules: { matches: () => true } });
	return { container, originalParent, editorEl, cm, file, view, methods, config, metadata, plugin };
}

describe("editable note navigation", () => {
	it("moves the existing editor directly between shells and restores its original parent", async () => {
		const s = setup();
		await s.methods.injectEditableView(s.view, s.file, s.config);
		const dispatch = vi.spyOn(s.cm, "dispatch");
		const next = new TFile(); next.path = "Movies/Second.md"; s.view.file = next;
		await s.methods.injectEditableView(s.view, next, s.config);
		expect(dispatch).not.toHaveBeenCalled();
		expect(s.container.querySelectorAll(".obsidian-custom-view-render")).toHaveLength(1);
		expect(s.editorEl.closest(".obsidian-custom-view-render")).not.toBeNull();
		s.methods.restoreEditableView(s.view);
		expect(s.editorEl.parentElement).toBe(s.originalParent);
		expect(s.container.querySelector(".obsidian-custom-view-render")).toBeNull();
	});
	it("discards a shell if navigation changes files while rendering", async () => {
		const s = setup();
		let finish!: () => void;
		vi.mocked(renderTemplate).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
		const pending = s.methods.injectEditableView(s.view, s.file, s.config);
		s.view.file = new TFile();
		finish(); await pending;
		expect(s.container.querySelector(".obsidian-custom-view-render")).toBeNull();
		expect(s.editorEl.parentElement).toBe(s.originalParent);
	});
});

describe("open note changes", () => {
	it.each(["rename", "delete"])("refreshes dependent views on a vault %s event", async event => {
		const s = setup(); await s.methods._processLeaf(s.view, s.file);
		const linked = new TFile(); linked.path = "People/Actor.md";
		vi.mocked(getTemplateDependencies).mockReturnValue(new Set([linked]));
		const listeners = new Map<string, (file: TFile) => void>();
		Object.assign(s.plugin.app, { vault: { on: (name: string, callback: (file: TFile) => void) => listeners.set(name, callback) } });
		Object.assign(s.plugin.app.metadataCache, { on: vi.fn() });
		Object.assign(s.plugin, { registerEvent: vi.fn() });
		(s.plugin as unknown as { registerNoteRefreshEvents(): void }).registerNoteRefreshEvents();
		vi.mocked(renderTemplate).mockClear(); vi.useFakeTimers();
		if (event === "rename") linked.path = "People/Renamed.md";
		listeners.get(event)!(linked);
		await vi.advanceTimersByTimeAsync(150);
		expect(renderTemplate).toHaveBeenCalledOnce();
		expect(vi.mocked(renderTemplate).mock.calls[0]?.[2]).toBe(s.file);
	});
	it("does not try to render a deleted note that has not yet closed", async () => {
		const s = setup(); s.view.getState = () => ({ mode: "preview", source: false });
		await s.methods._processLeaf(s.view, s.file);
		vi.mocked(renderTemplate).mockClear(); vi.useFakeTimers();
		(s.plugin as unknown as { queueNoteRefresh(file: TFile, dependenciesOnly: boolean): void }).queueNoteRefresh(s.file, true);
		await vi.advanceTimersByTimeAsync(150);
		expect(renderTemplate).not.toHaveBeenCalled();
	});

	it("refreshes a view when a linked note used by its template changes", async () => {
		const s = setup(); await s.methods._processLeaf(s.view, s.file);
		const linked = new TFile(); linked.path = "People/Actor.md";
		vi.mocked(getTemplateDependencies).mockReturnValue(new Set([linked]));
		vi.mocked(renderTemplate).mockClear(); vi.useFakeTimers();
		s.methods.queueNoteRefresh(linked);
		await vi.advanceTimersByTimeAsync(150);
		expect(renderTemplate).toHaveBeenCalledOnce();
		expect(vi.mocked(renderTemplate).mock.calls[0]?.[2]).toBe(s.file);
		expect(s.container.querySelectorAll(".cm-editor")).toHaveLength(1);
	});
	it("does not refresh a view for an unrelated note change", async () => {
		const s = setup(); await s.methods._processLeaf(s.view, s.file);
		vi.mocked(getTemplateDependencies).mockReturnValue(new Set());
		vi.mocked(renderTemplate).mockClear(); vi.useFakeTimers();
		s.methods.queueNoteRefresh(new TFile());
		await vi.advanceTimersByTimeAsync(150);
		expect(renderTemplate).not.toHaveBeenCalled();
	});
	it("refreshes changed properties without navigating away", async () => {
		const s = setup(); await s.methods._processLeaf(s.view, s.file);
		vi.mocked(renderTemplate).mockClear(); vi.useFakeTimers();
		s.metadata.frontmatter.title = "Updated";
		s.methods.queueNoteRefresh(s.file);
		await vi.advanceTimersByTimeAsync(150);
		expect(renderTemplate).toHaveBeenCalledOnce();
		expect(s.container.querySelectorAll(".obsidian-custom-view-render")).toHaveLength(1);
	});
	it("leaves the editable shell and editor intact for body-only typing", async () => {
		const s = setup(); await s.methods._processLeaf(s.view, s.file);
		const overlay = s.container.querySelector(".obsidian-custom-view-render");
		vi.mocked(renderTemplate).mockClear(); vi.useFakeTimers();
		s.methods.queueNoteRefresh(s.file);
		await vi.advanceTimersByTimeAsync(150);
		expect(renderTemplate).not.toHaveBeenCalled();
		expect(s.container.querySelector(".obsidian-custom-view-render")).toBe(overlay);
	});
	it("updates read-only content and coalesces a burst of changes", async () => {
		const s = setup(); s.view.getState = () => ({ mode: "preview", source: false });
		await s.methods._processLeaf(s.view, s.file);
		vi.mocked(renderTemplate).mockClear(); vi.useFakeTimers();
		s.methods.queueNoteRefresh(s.file);
		await vi.advanceTimersByTimeAsync(100);
		s.methods.queueNoteRefresh(s.file);
		await vi.advanceTimersByTimeAsync(100);
		expect(renderTemplate).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(50);
		expect(renderTemplate).toHaveBeenCalledOnce();
	});
	it("does not render the old file after navigation during the debounce", async () => {
		const s = setup(); await s.methods._processLeaf(s.view, s.file);
		vi.mocked(renderTemplate).mockClear(); vi.useFakeTimers();
		s.metadata.frontmatter.title = "Updated";
		s.methods.queueNoteRefresh(s.file); s.view.file = new TFile();
		await vi.advanceTimersByTimeAsync(150);
		expect(renderTemplate).not.toHaveBeenCalled();
	});
});


describe("canvas rendering lifetime", () => {
	function canvasSetup() {
		const s = setup(); s.plugin.settings.workInCanvas = true; s.file.extension = "md";
		const nodeEl = window.document.createElement("div");
		const preview = nodeEl.appendChild(window.document.createElement("div"));
		preview.className = "markdown-preview-view";
		const node = { file: s.file, nodeEl };
		s.plugin.app.workspace.iterateAllLeaves = callback => callback({ view: { canvas: { nodes: [node] } } } as unknown as WorkspaceLeaf);
		return { ...s, node, preview };
	}
	it.each(["cleared", "image"])("cancels pending Markdown rendering after the node becomes %s", async kind => {
		const s = canvasSetup(); let finish!: () => void;
		vi.mocked(renderTemplate).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
		const pending = s.plugin.processCanvasNode(s.node); await Promise.resolve();
		expect(s.preview.querySelector(".obsidian-custom-view-render")).not.toBeNull();
		if (kind === "cleared") Reflect.deleteProperty(s.node, "file");
		else { s.node.file = new TFile(); s.node.file.extension = "png"; s.node.file.path = "Poster.png"; }
		s.plugin.processAllCanvasNodes();
		expect(s.preview.querySelector(".obsidian-custom-view-render")).toBeNull();
		finish(); await pending;
		expect(s.preview.querySelector(".obsidian-custom-view-render")).toBeNull();
	});
	it("coalesces repeated requests while a canvas node render is pending", async () => {
		const s = canvasSetup(); let finish!: () => void;
		const render = vi.spyOn(s.plugin, "injectCustomView").mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
		const first = s.plugin.processCanvasNode(s.node); const second = s.plugin.processCanvasNode(s.node);
		await Promise.resolve(); expect(render).toHaveBeenCalledOnce();
		finish(); await Promise.all([first, second]);
	});
	it("removes a pending overlay when canvas rendering is disabled", async () => {
		const s = canvasSetup(); let finish!: () => void;
		vi.mocked(renderTemplate).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
		const pending = s.plugin.processCanvasNode(s.node); await Promise.resolve();
		expect(s.preview.querySelector(".obsidian-custom-view-render")).not.toBeNull();
		s.plugin.settings.workInCanvas = false;
		Object.assign(s.plugin, { prepareScriptEngine: vi.fn() });
		s.plugin.refreshAllViews();
		expect(s.preview.querySelector(".obsidian-custom-view-render")).toBeNull();
		finish(); await pending;
		expect(s.preview.querySelector(".obsidian-custom-view-render")).toBeNull();
	});
	it("aborts an old node render when the node changes files", async () => {
		const s = canvasSetup(); const signals: AbortSignal[] = [];
		const render = vi.spyOn(s.plugin, "injectCustomView").mockImplementation(async (_container, _file, _template, _config, _source, signal) => { signals.push(signal!); await new Promise<void>(resolve => signal!.addEventListener("abort", () => resolve(), { once: true })); });
		const first = s.plugin.processCanvasNode(s.node); await Promise.resolve();
		s.node.file = new TFile(); s.node.file.path = "Other.md"; s.node.file.extension = "md";
		const second = s.plugin.processCanvasNode(s.node); await Promise.resolve();
		expect(signals[0]?.aborted).toBe(true); expect(render).toHaveBeenCalledTimes(2);
		s.plugin.restoreCanvasNode(s.node); await Promise.all([first, second]);
	});
});
