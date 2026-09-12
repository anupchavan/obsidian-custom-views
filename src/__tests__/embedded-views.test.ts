import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type App, type MarkdownView } from "obsidian";
import type { ViewContext } from "../types";
import * as renderer from "../renderer";
import { EmbeddedViews } from "../embedded-views";

const managers: EmbeddedViews[] = [];
afterEach(() => { managers.splice(0).forEach(manager => manager.dispose()); window.document.body.replaceChildren(); });
function setup(kind = "hover-popover", connected = true) {
	const outer = window.document.createElement("div"); outer.className = kind;
	const root = outer.appendChild(window.document.createElement("div"));
	if (connected) window.document.body.append(outer);
	const file = new TFile(); file.path = "Contact.md"; file.stat = { mtime: 1, ctime: 1, size: 10 };
	let mode = "preview";
	const embed = { containerEl: root, file, text: "Body", data: "Body", subpath: "", getMode: () => mode,
		set: vi.fn(), showEditor: vi.fn(() => { mode = "source"; }), showPreview: vi.fn(() => { mode = "preview"; }), unload: vi.fn() };
	const original = vi.fn(() => embed);
	const registry = { md: original };
	const enabled = vi.fn(() => true);
	const render = vi.fn(async (_view: MarkdownView, _context: ViewContext, _changed: boolean) => { root.setAttribute("data-cv-state", "applied"); root.innerHTML = '<div class="obsidian-custom-view-render"></div>'; });
	const reset = vi.fn(() => { root.replaceChildren(); root.removeAttribute("data-cv-state"); });
	const manager = new EmbeddedViews({ embedRegistry: { embedByExtension: registry } } as unknown as App, enabled, render, reset);
	managers.push(manager); registry.md();
	return { root, outer, embed, registry, original, enabled, render, reset, manager };
}
describe("native embedded view lifecycle", () => {
	it.each([["hover-popover", "popover"], ["canvas-node", "canvas"], ["markdown-embed", "embed"]])("detects %s and retains completed renders", async (kind, context) => {
		const s = setup(kind); await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
		expect(s.render.mock.calls[0][1]).toBe(context);
		s.manager.refresh(); s.manager.refresh();
		expect(s.render).toHaveBeenCalledOnce();
		s.embed.file.stat.mtime++; s.manager.refresh();
		await vi.waitFor(() => expect(s.render).toHaveBeenCalledTimes(2));
	});
	it("supports read-only Markdown embeds without editor mode APIs", async () => {
		const s = setup("markdown-embed");
		Reflect.deleteProperty(s.embed, "getMode");
		await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
		expect(s.render.mock.calls[0][0].getState().mode).toBe("preview");
	});
	it("keeps the editable shell while the native editor saves body changes", async () => {
		const s = setup("canvas-node");
		s.embed.showEditor(); s.root.classList.add("obsidian-custom-view-editable");
		await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
		s.embed.file.stat.mtime++; s.embed.text = "Edited body";
		s.manager.refresh();
		expect(s.render).toHaveBeenCalledOnce();
	});
	it("renders immediately when a newly constructed embed is attached", async () => {
		const s = setup("hover-popover", false); await Promise.resolve(); expect(s.render).not.toHaveBeenCalled();
		window.document.body.append(s.outer);
		await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
	});
	it("restores the editor before host mode changes and ignores callbacks after unload", async () => {
		const s = setup(); await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
		s.embed.showEditor(); expect(s.reset).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(s.render).toHaveBeenCalledTimes(2));
		s.embed.unload(); s.manager.refresh(); await Promise.resolve();
		expect(s.render).toHaveBeenCalledTimes(2);
		s.manager.dispose(); expect(s.registry.md).toBe(s.original);
	});
	it("does not recreate an editor already in live preview", async () => {
		const s = setup(); await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
		s.embed.showEditor();
		await vi.waitFor(() => expect(s.render).toHaveBeenCalledTimes(2));
		const calls = s.reset.mock.calls.length;
		s.embed.showEditor(); s.embed.showEditor();
		expect(s.reset).toHaveBeenCalledTimes(calls);
		expect(s.render).toHaveBeenCalledTimes(2);
	});
	it("keeps the mounted view when Canvas requests reading mode again", async () => {
		const s = setup("canvas-node");
		await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
		const overlay = s.root.firstElementChild;
		s.embed.showPreview(); s.embed.showPreview();
		await Promise.resolve();
		expect(s.root.firstElementChild).toBe(overlay);
		expect(s.reset).not.toHaveBeenCalled();
		expect(s.render).toHaveBeenCalledOnce();
	});
	it("ignores DOM updates outside tracked embeds", async () => {
		const s = setup("canvas-node");
		await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
		s.enabled.mockClear();
		window.document.body.append(window.document.createElement("div"));
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(s.enabled).not.toHaveBeenCalled();
	});

	it("refreshes changed dependencies without touching unrelated embeds", async () => {
		const s = setup("canvas-node");
		await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
		const related = new TFile(); related.path = "Related.md";
		const unrelated = new TFile(); unrelated.path = "Unrelated.md";
		const dependencies = vi.spyOn(renderer, "getTemplateDependencies").mockReturnValue(new Set([related]));
		try {
			s.enabled.mockClear(); s.manager.refreshFile(unrelated);
			expect(s.enabled).not.toHaveBeenCalled();
			s.manager.refreshFile(related);
			await vi.waitFor(() => expect(s.render).toHaveBeenCalledTimes(2));
			expect(s.render.mock.calls[1][2]).toBe(true);
		} finally { dependencies.mockRestore(); }
	});

	it("coalesces pending renders and ignores a superseded rejection", async () => {
		const s = setup("canvas-node");
		let reject!: (error: Error) => void;
		s.render.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
		await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
		s.manager.refresh(); s.manager.refresh();
		expect(s.render).toHaveBeenCalledOnce();
		s.embed.file.stat.mtime++;
		s.manager.refresh();
		await vi.waitFor(() => expect(s.render).toHaveBeenCalledTimes(2));
		const overlay = s.root.firstElementChild;
		reject(new Error("obsolete render"));
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(s.reset).not.toHaveBeenCalled();
		expect(s.root.firstElementChild).toBe(overlay);
	});

	it("leaves excerpts and embeds inside custom templates native", async () => {
		const s = setup(); s.embed.subpath = "#Heading";
		await Promise.resolve(); expect(s.render).not.toHaveBeenCalled();
		s.embed.subpath = ""; s.outer.className = "obsidian-custom-view-render";
		s.manager.refresh(); expect(s.render).not.toHaveBeenCalled();
	});
	it("restores disabled contexts and reapplies after re-enabling", async () => {
		const s = setup(); await vi.waitFor(() => expect(s.render).toHaveBeenCalledOnce());
		s.enabled.mockReturnValue(false); s.manager.refresh(); expect(s.root.children).toHaveLength(0);
		s.enabled.mockReturnValue(true); s.manager.refresh();
		await vi.waitFor(() => expect(s.render).toHaveBeenCalledTimes(2));
	});
});
