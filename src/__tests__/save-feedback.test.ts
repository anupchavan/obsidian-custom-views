import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, type PluginManifest } from "obsidian";
import { SaveFeedback } from "../save-feedback";
import CustomViewsPlugin from "../main";
import { DEFAULT_SETTINGS } from "../settings";

vi.mock("obsidian", async original => ({
	...await original<typeof import("obsidian")>(),
	Notice: class {
		containerEl = window.document.body.appendChild(window.document.createElement("div"));
		constructor(message: DocumentFragment, duration: number) {
			expect(duration).toBe(0);
			this.containerEl.appendChild(message);
		}
		hide() { this.containerEl.remove(); }
	},
}));
beforeEach(() => {
	vi.stubGlobal("activeDocument", window.document);
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { window.document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("failed settings saves", () => {
	it("shows one persistent retry notice for repeated autosave failures", () => {
		const feedback = new SaveFeedback(vi.fn());
		feedback.failed(new Error("Disk full")); feedback.failed(new Error("Disk full"));
		expect(window.document.body.children).toHaveLength(1);
		expect(window.document.body.textContent).toContain("still in memory");
		expect(window.document.querySelector("button")?.textContent).toBe("Retry saving");
		feedback.clear(); expect(window.document.body.children).toHaveLength(0);
	});
	it("prevents duplicate retries while a save is pending", async () => {
		let finish!: () => void;
		const retry = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
		const feedback = new SaveFeedback(retry); feedback.failed(new Error("Offline"));
		const button = window.document.querySelector("button")!;
		button.click(); button.click();
		expect(retry).toHaveBeenCalledOnce(); expect(button.disabled).toBe(true);
		finish(); await Promise.resolve(); await Promise.resolve();
		expect(button.disabled).toBe(false);
	});
	it("keeps edits in memory after failure and clears the notice after a successful plugin save", async () => {
		const plugin = new CustomViewsPlugin(new App(), {} as PluginManifest);
		plugin.settings = structuredClone(DEFAULT_SETTINGS);
		plugin.settings.views[0].name = "Unsaved edit";
		const write = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockResolvedValue(undefined);
		Object.assign(plugin, { saveData: write });
		await expect(plugin.saveSettings()).rejects.toThrow("Disk full");
		expect(window.document.querySelector("button")).not.toBeNull();
		expect(plugin.settings.views[0].name).toBe("Unsaved edit");
		await plugin.saveSettings();
		expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ views: [expect.objectContaining({ name: "Unsaved edit" })] }));
		expect(window.document.body.children).toHaveLength(0);
	});
});
