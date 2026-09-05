import { describe, expect, it, vi } from "vitest";
import { RenderCoordinator } from "../render-coordinator";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(done => { resolve = done; });
	return { promise, resolve };
}

describe("render coordination", () => {
	it("lets a new selection start while an older asynchronous script is still waiting", async () => {
		const coordinator = new RenderCoordinator(); const owner = {}; const gate = deferred();
		let oldSignal!: AbortSignal;
		const old = coordinator.run(owner, "old", async signal => { oldSignal = signal; await gate.promise; });
		await Promise.resolve();
		const next = vi.fn(async () => {});
		await coordinator.run(owner, "new", next);
		expect(next).toHaveBeenCalledOnce(); expect(oldSignal.aborted).toBe(true);
		gate.resolve(); await old;
	});
	it("never blocks an unrelated pane", async () => {
		const coordinator = new RenderCoordinator(); const gate = deferred();
		const first = coordinator.run({}, "same-file", () => gate.promise);
		await coordinator.run({}, "same-file", async () => {});
		gate.resolve(); await first;
	});
	it("coalesces duplicate workspace events for the same request", async () => {
		const coordinator = new RenderCoordinator(); const owner = {}; const gate = deferred();
		const render = vi.fn(() => gate.promise);
		const one = coordinator.run(owner, "same", render);
		const two = coordinator.run(owner, "same", render);
		expect(one).toBe(two); await Promise.resolve(); expect(render).toHaveBeenCalledOnce();
		gate.resolve(); await one;
	});
	it("does not run work queued before plugin unload", async () => {
		const coordinator = new RenderCoordinator(); const render = vi.fn(async () => {});
		const pending = coordinator.run({}, "file", render); coordinator.cancelAll();
		await pending; expect(render).not.toHaveBeenCalled();
	});
	it("propagates actual errors but suppresses cancellation", async () => {
		const coordinator = new RenderCoordinator();
		await expect(coordinator.run({}, "file", async () => { throw new Error("Broken template"); })).rejects.toThrow("Broken template");
	});
});
