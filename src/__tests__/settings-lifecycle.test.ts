// Test the shipped stylesheet in the DOM; Node is used only by the test runner.
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
	it.each(["focused", "moved", "closed", "detached"])("respects %s name-input focus when deferred selection runs", state => {
		const s = setup();
		const input = window.document.body.appendChild(window.document.createElement("input")); input.value = "View name";
		const other = window.document.body.appendChild(window.document.createElement("input"));
		const select = vi.spyOn(input, "select"); let callback!: FrameRequestCallback;
		const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation(fn => { callback = fn; return 123; });
		const cancel = vi.spyOn(window, "cancelAnimationFrame");
		try {
			input.focus();
			const schedule = Reflect.get(s.modal, "selectFocusedName") as (input: HTMLInputElement) => void;
			schedule.call(s.modal, input);
			if (state === "moved") other.focus();
			if (state === "closed") s.modal.onClose();
			if (state === "detached") input.remove();
			callback(0);
			expect(select).toHaveBeenCalledTimes(state === "focused" ? 1 : 0);
			if (state === "moved") expect(window.document.activeElement).toBe(other);
			if (state === "closed") expect(cancel).toHaveBeenCalledWith(123);
		} finally { s.modal.onClose(); input.remove(); other.remove(); request.mockRestore(); cancel.mockRestore(); }
	});

	it("schedules selection in the input's own window", () => {
		const s = setup();
		const frame = window.document.body.appendChild(window.document.createElement("iframe"));
		const childWindow = frame.contentWindow!; const childDocument = frame.contentDocument!;
		const input = childDocument.body.appendChild(childDocument.createElement("input"));
		const request = vi.spyOn(childWindow, "requestAnimationFrame").mockReturnValue(99);
		const cancel = vi.spyOn(childWindow, "cancelAnimationFrame");
		try {
			const schedule = Reflect.get(s.modal, "selectFocusedName") as (input: HTMLInputElement) => void;
			schedule.call(s.modal, input); s.modal.onClose();
			expect(request).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledWith(99);
		} finally { s.modal.onClose(); request.mockRestore(); cancel.mockRestore(); frame.remove(); }
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


describe("navigation hold styling", () => {
	it("masks the working pane without changing inline opacity or layout", () => {
		const style = window.document.createElement("style");
		style.textContent = readFileSync("styles.css", "utf8"); window.document.head.appendChild(style);
		const content = window.document.body.appendChild(window.document.createElement("div"));
		content.className = "view-content cv-navigation-preparing";
		content.style.setProperty("opacity", "0.8", "important");
		try {
			expect(window.getComputedStyle(content).filter).toBe("opacity(0)");
			expect(window.getComputedStyle(content).display).not.toBe("none");
			expect(content.style.opacity).toBe("0.8");
			content.classList.remove("cv-navigation-preparing");
			expect(window.getComputedStyle(content).filter).not.toBe("opacity(0)");
			expect(content.style.getPropertyPriority("opacity")).toBe("important");
		} finally { content.remove(); style.remove(); }
	});
});

describe("custom view navigation layout", () => {
	it.each(["obsidian-custom-view-editable", "obsidian-custom-view-hidden"])("anchors %s below the header and scopes hiding to that pane", mode => {
		const style = window.document.createElement("style");
		style.textContent = ".view-header { display: flex; }\n" + readFileSync("styles.css", "utf8");
		window.document.head.appendChild(style);
		const pane = window.document.body.appendChild(window.document.createElement("div"));
		pane.className = "workspace-leaf-content";
		const header = pane.appendChild(window.document.createElement("div")); header.className = "view-header";
		const content = pane.appendChild(window.document.createElement("div")); content.className = `view-content ${mode}`;
		try {
			expect(window.getComputedStyle(content).position).toBe("relative");
			expect(window.getComputedStyle(header).display).toBe("flex");
			pane.classList.add("cv-hide-navigation");
			expect(window.getComputedStyle(header).display).toBe("none");
			pane.classList.remove("cv-hide-navigation");
			expect(window.getComputedStyle(header).display).toBe("flex");
		} finally { pane.remove(); style.remove(); }
	});
});
