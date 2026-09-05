import { afterEach, describe, expect, it, vi } from "vitest";
import { App, MarkdownView, WorkspaceLeaf, type ViewState } from "obsidian";
import { AtomicNavigation } from "../atomic-navigation";

// eslint-disable-next-line @typescript-eslint/unbound-method -- Restore the exact prototype method after each test.
const original = MarkdownView.prototype.setState;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Restore the exact native method.
const originalLeaf = WorkspaceLeaf.prototype.setViewState;
const installed: AtomicNavigation[] = [];
afterEach(() => {
	installed.splice(0).forEach(navigation => navigation.dispose());
	MarkdownView.prototype.setState = original;
	WorkspaceLeaf.prototype.setViewState = originalLeaf;
	window.document.body.replaceChildren();
	Reflect.deleteProperty(window.document, "startViewTransition");
});
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(done => { resolve = done; });
	return { promise, resolve };
}
function setup(load = async () => {}) {
	const transition = vi.fn((update: () => Promise<void>) => {
		const finished = Promise.resolve().then(update);
		return { finished, ready: finished, skipTransition: vi.fn() };
	});
	Object.assign(window.document, { startViewTransition: transition });
	const app = new App();
	const contentEl = window.document.body.appendChild(window.document.createElement("div"));
	contentEl.textContent = "Previous custom note";
	const leaf = Object.assign(new WorkspaceLeaf(), { app });
	const view = Object.assign(new MarkdownView(leaf), { app, contentEl, leaf });
	Object.assign(leaf, { view });
	let working = false;
	WorkspaceLeaf.prototype.setViewState = async function (state: ViewState) {
		if (working) return;
		working = true;
		try { await view.setState(state.state ?? {}, { history: false }); }
		finally { working = false; }
	};
	const native = vi.fn(async function (this: MarkdownView) {
		this.contentEl.textContent = "Normal editor";
		await load();
	});
	MarkdownView.prototype.setState = native;
	const render = vi.fn(async () => { contentEl.textContent = "Next custom note"; });
	const predicate = vi.fn(() => true);
	const navigation = new AtomicNavigation(app, predicate, render);
	navigation.strategy = "compositor";
	installed.push(navigation);
	return { view, leaf, contentEl, native, render, predicate, navigation, transition };
}
describe("experimental atomic navigation", () => {
	it("holds the previous note before native code runs and reveals only after the custom render", async () => {
		const loading = deferred(); const rendering = deferred(); const s = setup(() => loading.promise);
		s.render.mockImplementation(async () => { await rendering.promise; s.contentEl.textContent = "Ready"; });
		const pending = s.view.setState({ file: "next.md" }, { history: false });
		expect(s.contentEl.textContent).toBe("Previous custom note");
		expect(window.document.documentElement.hasAttribute("data-cv-navigation-held")).toBe(true);
		await Promise.resolve();
		expect(s.contentEl.textContent).toBe("Normal editor");
		loading.resolve(); await Promise.resolve(); await Promise.resolve();
		expect(window.document.documentElement.hasAttribute("data-cv-navigation-held")).toBe(true);
		rendering.resolve(); await pending;
		expect(s.contentEl.textContent).toBe("Ready");
		expect(s.contentEl.style.opacity).toBe("");
		expect(window.document.documentElement.hasAttribute("data-cv-navigation-held")).toBe(false);
	});
	it("keeps the hold when an earlier navigation finishes before the latest request", async () => {
		const first = deferred(); const second = deferred(); let call = 0;
		const s = setup(() => (++call === 1 ? first : second).promise);
		const one = s.view.setState({ file: "one.md" }, { history: false });
		const two = s.view.setState({ file: "two.md" }, { history: false });
		expect(s.transition).toHaveBeenCalledOnce();
		first.resolve(); await Promise.resolve(); await Promise.resolve();
		expect(window.document.documentElement.hasAttribute("data-cv-navigation-held")).toBe(true);
		second.resolve(); await Promise.all([one, two]);
		expect(s.contentEl.style.opacity).toBe("");
	});
	it("restores visibility after failure", async () => {
		const s = setup(async () => { throw new Error("Read failed"); });
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment -- Fixture verifies restoration of existing inline styles.
		s.contentEl.style.setProperty("opacity", "0.8", "important");
		await expect(s.view.setState({}, { history: false })).rejects.toThrow("Read failed");
		expect(s.contentEl.style.opacity).toBe("0.8");
		expect(s.contentEl.style.getPropertyPriority("opacity")).toBe("important");
		expect(window.document.documentElement.hasAttribute("data-cv-navigation-held")).toBe(false);
	});
	it("releases an in-flight hold and restores the native method on disable", async () => {
		const loading = deferred(); const s = setup(() => loading.promise);
		const pending = s.view.setState({}, { history: false });
		s.navigation.dispose();
		expect(s.contentEl.style.opacity).toBe("");
		// eslint-disable-next-line @typescript-eslint/unbound-method -- Compare function identity without invoking it.
		expect(MarkdownView.prototype.setState).toBe(s.native);
		loading.resolve(); await pending;
	});
	it("does not intercept ordinary notes", async () => {
		const s = setup(); s.predicate.mockReturnValue(false);
		await s.view.setState({}, { history: false });
		expect(s.native).toHaveBeenCalledOnce(); expect(s.render).not.toHaveBeenCalled();
		expect(window.document.documentElement.hasAttribute("data-cv-navigation-held")).toBe(false);
	});
	it("serializes native loads so an older request cannot finish after the newest one", async () => {
		const first = deferred(); let call = 0;
		const s = setup(async () => { if (++call === 1) await first.promise; });
		s.navigation.strategy = "retained";
		const one = s.view.setState({ file: "one.md" }, { history: false });
		const two = s.view.setState({ file: "two.md" }, { history: false });
		const three = s.view.setState({ file: "three.md" }, { history: false });
		expect(s.native).toHaveBeenCalledOnce();
		first.resolve(); await Promise.all([one, two, three]);
		expect(s.native.mock.calls.map(args => (args as unknown as [{ file: string }])[0].file)).toEqual(["one.md", "two.md", "three.md"]);
		expect(window.document.querySelector(".cv-navigation-snapshot")).toBeNull();
	});
	it("queues requests before Obsidian's busy-leaf guard can discard rapid clicks", async () => {
		const first = deferred(); let call = 0;
		const s = setup(async () => { if (++call === 1) await first.promise; });
		s.navigation.strategy = "retained";
		const pending = ["one.md", "two.md", "three.md"].map(file => s.leaf.setViewState({ type: "markdown", state: { file } }));
		expect(s.native).toHaveBeenCalledOnce();
		first.resolve(); await Promise.all(pending);
		expect(s.native.mock.calls.map(args => (args as unknown as [{ file: string }])[0].file)).toEqual(["one.md", "two.md", "three.md"]);
		expect(window.document.querySelector(".cv-navigation-snapshot")).toBeNull();
	});
});
