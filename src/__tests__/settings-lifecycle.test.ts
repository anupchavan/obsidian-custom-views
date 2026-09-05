// Test the shipped stylesheet in the DOM; Node is used only by the test runner.
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { App, type PluginManifest } from "obsidian";
import CustomViewsPlugin from "../main";
import { DEFAULT_SETTINGS, EditViewModal } from "../settings";

vi.mock("obsidian", async original => ({
	...await original<typeof import("obsidian")>(),
	Modal: class {
		contentEl = Object.assign(window.document.createElement("div"), { empty: vi.fn() });
		setTitle() {}
		close() { (this as unknown as { onClose(): void }).onClose(); }
	},
}));
function setup() {
	const plugin = new CustomViewsPlugin(new App(), {} as PluginManifest);
	plugin.app = { workspace: { iterateAllLeaves: () => {} } } as unknown as App;
	plugin.settings = structuredClone(DEFAULT_SETTINGS);
	const save = vi.spyOn(plugin, "saveSettings").mockResolvedValue(undefined);
	const done = vi.fn();
	const modal = new EditViewModal(plugin.app, plugin, plugin.settings.views[0], done);
	const filterCleanup = vi.fn(); const htmlCleanup = vi.fn(); const cssCleanup = vi.fn(); const jsCleanup = vi.fn();
	Object.assign(modal, { disposeFilters: filterCleanup, templateEditor: { destroy: htmlCleanup }, cssEditor: { destroy: cssCleanup }, jsEditor: { destroy: jsCleanup } });
	const saveChanges = Reflect.get(modal, "saveChanges") as () => void;
	return { plugin, modal, save, done, saveChanges, cleanups: [filterCleanup, htmlCleanup, cssCleanup, jsCleanup] };
}
describe("settings dialog lifetime", () => {
	it("closes and cleans up every editor when the plugin unloads", () => {
		const s = setup();
		s.plugin.onunload();
		for (const cleanup of s.cleanups) expect(cleanup).toHaveBeenCalledOnce();
		expect(s.done).not.toHaveBeenCalled();
		s.saveChanges(); expect(s.save).not.toHaveBeenCalled();
	});
	it("saves while open and ignores delayed callbacks after normal closure", () => {
		const s = setup(); s.saveChanges(); expect(s.save).toHaveBeenCalledOnce();
		s.modal.onClose(); s.modal.onClose(); s.saveChanges();
		expect(s.save).toHaveBeenCalledOnce(); expect(s.done).toHaveBeenCalledOnce();
		for (const cleanup of s.cleanups) expect(cleanup).toHaveBeenCalledOnce();
		s.plugin.onunload();
		expect(s.done).toHaveBeenCalledOnce();
	});
	it.each([0, 1, 2, 3])("finishes closing when editor cleanup %i throws", index => {
		const s = setup();
		const error = new Error("Editor cleanup failed");
		s.cleanups[index].mockImplementation(() => { throw error; });
		const report = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(() => s.modal.onClose()).not.toThrow();
			for (const cleanup of s.cleanups) expect(cleanup).toHaveBeenCalledOnce();
			expect(Reflect.get(s.modal.contentEl, "empty")).toHaveBeenCalledOnce();
			expect(s.done).toHaveBeenCalledOnce();
			expect(report).toHaveBeenCalledWith("[Custom Views] Could not clean up a settings editor:", error);
			s.modal.onClose(); s.plugin.onunload();
			for (const cleanup of s.cleanups) expect(cleanup).toHaveBeenCalledOnce();
		} finally { report.mockRestore(); }
	});

});


describe("settings dialog layout", () => {
	it("applies height and scrolling limits to the actual modal content element", () => {
		const style = window.document.createElement("style");
		style.textContent = readFileSync("styles.css", "utf8");
		window.document.head.appendChild(style);
		const content = window.document.body.appendChild(window.document.createElement("div"));
		content.className = "modal-content cv-edit-view-modal";
		try {
			const computed = window.getComputedStyle(content);
			expect(computed.maxHeight).toBe("80vh");
			expect(computed.overflowY).toBe("auto");
		} finally { content.remove(); style.remove(); }
	});
});
