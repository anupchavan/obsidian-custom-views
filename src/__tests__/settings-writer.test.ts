import { describe, expect, it, vi } from "vitest";
import { App, type PluginManifest } from "obsidian";
import CustomViewsPlugin from "../main";
import { DEFAULT_SETTINGS } from "../settings";
import { SettingsWriter, getSharedSettingsWriter } from "../settings-writer";

function deferred() {
	let resolve!: () => void; let reject!: (error: unknown) => void;
	const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}
describe("settings persistence", () => {
	it("serializes real plugin saves and keeps the latest edit when writes are slow", async () => {
		const first = deferred(); const last = deferred();
		const write = vi.fn<() => Promise<void>>().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
		const plugin = new CustomViewsPlugin(new App(), {} as PluginManifest);
		Object.assign(plugin, { saveData: write });
		plugin.settings = structuredClone(DEFAULT_SETTINGS);
		plugin.settings.views[0].name = "A"; const one = plugin.saveSettings();
		plugin.settings.views[0].name = "B"; const two = plugin.saveSettings();
		plugin.settings.views[0].name = "C"; const three = plugin.saveSettings();
		expect(write).toHaveBeenCalledOnce();
		first.resolve(); await one;
		expect(write).toHaveBeenCalledTimes(2);
		expect(write).toHaveBeenNthCalledWith(1, expect.objectContaining({ views: [expect.objectContaining({ name: "A" })] }));
		expect(write).toHaveBeenNthCalledWith(2, expect.objectContaining({ views: [expect.objectContaining({ name: "C" })] }));
		last.resolve(); await Promise.all([two, three]);
	});
	it("takes a snapshot before a pending write starts", async () => {
		const first = deferred(); const write = vi.fn<(value: { name: string }) => Promise<void>>().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
		const writer = new SettingsWriter(write);
		const one = writer.save({ name: "first" });
		const value = { name: "saved" }; const two = writer.save(value);
		value.name = "unsaved mutation";
		first.resolve(); await Promise.all([one, two]);
		expect(write).toHaveBeenLastCalledWith({ name: "saved" });
	});
	it("continues with newer edits after a failed write", async () => {
		const first = deferred(); const write = vi.fn<(value: string) => Promise<void>>().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
		const writer = new SettingsWriter(write);
		const one = writer.save("old"); const rejected = expect(one).rejects.toThrow("Disk full");
		const two = writer.save("new");
		first.reject(new Error("Disk full")); await rejected; await two;
		expect(write).toHaveBeenLastCalledWith("new");
	});
	it("rejects all callers covered by a failed queued write and allows a later retry", async () => {
		const first = deferred(); const write = vi.fn<(value: string) => Promise<void>>().mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue(undefined);
		const writer = new SettingsWriter(write);
		const one = writer.save("A"); const two = writer.save("B"); const three = writer.save("C");
		const rejected = Promise.all([expect(two).rejects.toThrow("Unavailable"), expect(three).rejects.toThrow("Unavailable")]);
		first.resolve(); await one; await rejected;
		await writer.save("retry");
		expect(write).toHaveBeenLastCalledWith("retry");
	});
});


describe("settings writes across reloads", () => {
	it("waits for the old plugin's pending save before loading the new instance", async () => {
		const app = new App(); const pending = deferred();
		let disk = structuredClone(DEFAULT_SETTINGS);
		const old = new CustomViewsPlugin(app, {} as PluginManifest); old.app = app;
		old.settings = structuredClone(DEFAULT_SETTINGS); old.settings.views[0].name = "Latest edit";
		Object.assign(old, { saveData: async (value: typeof disk) => { await pending.promise; disk = value; } });
		const save = old.saveSettings();
		const next = new CustomViewsPlugin(app, {} as PluginManifest); next.app = app;
		const read = vi.fn(async () => disk); Object.assign(next, { loadData: read });
		const load = next.loadSettings(); await Promise.resolve();
		expect(read).not.toHaveBeenCalled();
		pending.resolve(); await save; await load;
		expect(next.settings.views[0].name).toBe("Latest edit");
	});
	it("serializes new instance saves behind old writes and uses each instance's callback", async () => {
		const app = {}; const pending = deferred(); const events: string[] = [];
		const old = getSharedSettingsWriter<string>(app, async value => { events.push("old start"); await pending.promise; events.push(value); });
		const next = getSharedSettingsWriter<string>(app, async value => { events.push(value); });
		const first = old.save("old end"); const second = next.save("new end");
		expect(events).toEqual(["old start"]);
		pending.resolve(); await Promise.all([first, second]);
		expect(events).toEqual(["old start", "old end", "new end"]);
	});
	it("does not block unrelated apps and releases idle waiters after failure", async () => {
		const pending = deferred();
		const first = getSharedSettingsWriter<string>({}, () => pending.promise);
		const otherWrite = vi.fn(async () => {});
		const other = getSharedSettingsWriter<string>({}, otherWrite);
		const failed = expect(first.save("first")).rejects.toThrow("Disk full");
		const idle = first.whenIdle();
		await other.save("other"); expect(otherWrite).toHaveBeenCalledWith("other");
		pending.reject(new Error("Disk full")); await failed; await idle;
	});
	it("retains the shared queue when the module is reloaded", async () => {
		const app = {}; const pending = deferred();
		const first = getSharedSettingsWriter<string>(app, () => pending.promise);
		const save = first.save("pending");
		vi.resetModules();
		const reloaded = await import("../settings-writer");
		const write = vi.fn(async () => {});
		const next = reloaded.getSharedSettingsWriter<string>(app, write);
		const nextSave = next.save("new"); expect(write).not.toHaveBeenCalled();
		pending.resolve(); await Promise.all([save, nextSave]);
		expect(write).toHaveBeenCalledWith("new");
	});
});
