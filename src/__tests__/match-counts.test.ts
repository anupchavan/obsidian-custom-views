import { describe, expect, it, vi } from "vitest";
import { TFile, type App, type FrontMatterCache } from "obsidian";
import { describeTally, MatchCounter, MatchPass, showCountLine, type RuleTest, type ViewTally } from "../match-counts";
import type { ViewConfig } from "../types";

function note(path: string, frontmatter: FrontMatterCache = {}) {
	const file = new TFile(); file.path = path;
	return { file, frontmatter };
}
const views = ["Movies", "Books", "Default", "Old"].map((name, index): ViewConfig => ({
	id: `v${index}`, name, rules: { type: "group", operator: "AND", conditions: [] }, template: "",
}));
const tagged = (tag: string): RuleTest => ({ all: false, test: (_file, frontmatter) => frontmatter?.type === tag });
const all: RuleTest = { all: true, test: () => true };

const vault = [
	note("a.md", { type: "movie" }), note("b.md", { type: "movie" }), note("c.md", { type: "book" }),
	note("d.md"), note("e.md", { type: "movie" }),
];
const frontmatterOf = (file: TFile) => vault.find(entry => entry.file === file)?.frontmatter;

describe("MatchPass", () => {
	const tests = [tagged("movie"), all, tagged("movie"), tagged("book")];
	const enabled = [true, true, true, false];

	it("gives each note to the first enabled match and records who took the rest", () => {
		const pass = new MatchPass(vault.map(entry => entry.file), frontmatterOf, tests, enabled);
		expect(pass.step(Infinity, () => 0)).toBe(true);
		expect(pass.result()).toEqual([
			{ off: false, all: false, unavailable: false, wins: 3, matches: 3, lost: 0, topTaker: -1, takers: 0 },
			{ off: false, all: true, unavailable: false, wins: 2, matches: 5, lost: 3, topTaker: 0, takers: 1 },
			{ off: false, all: false, unavailable: false, wins: 0, matches: 3, lost: 3, topTaker: 0, takers: 1 },
			// A switched-off view counts its matches but never takes notes from the views under it.
			{ off: true, all: false, unavailable: false, wins: 0, matches: 1, lost: 0, topTaker: -1, takers: 0 },
		]);
	});

	it("reads each note's frontmatter at most once, and not at all when no view needs it", () => {
		const read = vi.fn(frontmatterOf);
		new MatchPass(vault.map(entry => entry.file), read, tests, enabled).step(Infinity, () => 0);
		expect(read).toHaveBeenCalledTimes(vault.length);
		read.mockClear();
		new MatchPass(vault.map(entry => entry.file), read, [all, all], [true, true]).step(Infinity, () => 0);
		expect(read).not.toHaveBeenCalled();
	});

	it("yields at the deadline and resumes to the same result as one long pass", () => {
		const files = Array.from({ length: 300 }, (_, index) => vault[index % vault.length].file);
		const whole = new MatchPass(files, frontmatterOf, tests, enabled);
		whole.step(Infinity, () => 0);
		const sliced = new MatchPass(files, frontmatterOf, tests, enabled);
		let slices = 1;
		while (!sliced.step(0, () => 1)) slices++;
		expect(slices).toBe(5);
		expect(sliced.result()).toEqual(whole.result());
	});

	it("marks views whose rules can't be evaluated without testing them", () => {
		const pass = new MatchPass(vault.map(entry => entry.file), frontmatterOf, [null, all], [true, true]);
		pass.step(Infinity, () => 0);
		expect(pass.result()[0]).toMatchObject({ unavailable: true, wins: 0 });
		expect(pass.result()[1]).toMatchObject({ wins: 5, lost: 0 });
	});
});

describe("describeTally", () => {
	const tally = (fields: Partial<ViewTally>): ViewTally => ({
		off: false, all: false, unavailable: false, wins: 0, matches: 0, lost: 0, topTaker: -1, takers: 0, ...fields,
	});
	it.each([
		["a plain count", { wins: 9 }, "9 notes", "muted"],
		["one note", { wins: 1 }, "1 note", "muted"],
		["some lost to one view", { wins: 9, lost: 3, topTaker: 0, takers: 1 }, "9 notes · 3 more go to Movies", "muted"],
		["one lost", { wins: 9, lost: 1, topTaker: 0, takers: 1 }, "9 notes · 1 more goes to Movies", "muted"],
		["lost to several views", { wins: 9, lost: 5, topTaker: 1, takers: 3 }, "9 notes · 5 more go to Books and 2 others", "muted"],
		["lost to two views", { wins: 2, lost: 5, topTaker: 1, takers: 2 }, "2 notes · 5 more go to Books and 1 other", "muted"],
		["everything taken", { lost: 12, topTaker: 2, takers: 1 }, "0 notes · all 12 go to Default", "warning"],
		["its only match taken", { lost: 1, topTaker: 2, takers: 1 }, "0 notes · 1 goes to Default", "warning"],
		["no matches", {}, "No matching notes", "muted"],
		["no rules", { all: true, wins: 240 }, "No rules · 240 notes", "muted"],
		["no rules, everything taken", { all: true, lost: 4, topTaker: 0, takers: 1 }, "0 notes · all 4 go to Movies", "warning"],
		["switched off", { off: true, matches: 9 }, "Off · 9 notes", "faint"],
		["Bases unavailable", { unavailable: true, off: true }, "Rules need the Bases core plugin", "warning"],
		["thousands", { wins: 12345 }, `${(12345).toLocaleString()} notes`, "muted"],
	])("%s", (_name, fields, text, tone) => {
		expect(describeTally(tally(fields), views)).toEqual({ text, tone });
	});
});

describe("showCountLine", () => {
	it("reserves the line before a count exists and leaves the DOM alone when nothing changed", () => {
		const slot = document.createElement("div");
		showCountLine(slot, undefined);
		expect(slot.textContent).toBe(" ");
		showCountLine(slot, { text: "9 notes", tone: "muted" });
		const text = slot.firstChild;
		const observer = new MutationObserver(() => {});
		observer.observe(slot, { childList: true, characterData: true, attributes: true, subtree: true });
		showCountLine(slot, { text: "9 notes", tone: "muted" });
		expect(observer.takeRecords()).toEqual([]);
		expect(slot.firstChild).toBe(text);
		showCountLine(slot, { text: "0 notes · all 9 go to Movies", tone: "warning" });
		expect(slot.dataset.cvTone).toBe("warning");
		observer.disconnect();
	});
});

describe("MatchCounter", () => {
	function host(files = vault.map(entry => entry.file)) {
		const listeners = new Map<string, () => void>();
		const events = {
			on: (name: string, callback: () => void) => { listeners.set(name, callback); return { name }; },
			offref: (ref: { name: string }) => listeners.delete(ref.name),
		};
		const app = {
			metadataCache: { ...events, getFileCache: (file: TFile) => ({ frontmatter: frontmatterOf(file) }) },
			vault: { ...events, getMarkdownFiles: vi.fn(() => files) },
		} as unknown as App;
		const compile = vi.fn((view: ViewConfig) => view.id === "v0" ? tagged("movie") : all);
		return { app, listeners, compile, retry: vi.fn(async () => {}), views: () => views.slice(0, 2) };
	}

	it("reports a small vault before the next task, so the first paint already has counts", async () => {
		const h = host(); const onResult = vi.fn();
		const counter = new MatchCounter(h, onResult);
		counter.request();
		await Promise.resolve();
		expect(onResult).toHaveBeenCalledOnce();
		expect(onResult.mock.calls[0][0].map((tally: ViewTally) => tally.wins)).toEqual([3, 2]);
		counter.dispose();
	});

	it("coalesces requests in one tick and debounces vault changes into one recount", async () => {
		vi.useFakeTimers();
		try {
			const h = host(); const onResult = vi.fn();
			const counter = new MatchCounter(h, onResult);
			counter.request(); counter.request(); counter.request();
			await Promise.resolve();
			expect(onResult).toHaveBeenCalledTimes(1);
			for (let i = 0; i < 20; i++) h.listeners.get("changed")!();
			vi.advanceTimersByTime(999);
			expect(onResult).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(1);
			expect(onResult).toHaveBeenCalledTimes(2);
			expect(h.compile).toHaveBeenCalledTimes(4);
			counter.dispose();
		} finally { vi.useRealTimers(); }
	});

	it("drops a slow pass when a newer one starts, and stops listening once disposed", async () => {
		vi.useFakeTimers();
		try {
			const many = Array.from({ length: 5000 }, (_, index) => vault[index % vault.length].file);
			const h = host(many);
			let clock = 0;
			vi.spyOn(performance, "now").mockImplementation(() => (clock += 1));
			const onResult = vi.fn();
			const counter = new MatchCounter(h, onResult);
			counter.request();
			await Promise.resolve();
			expect(onResult).not.toHaveBeenCalled();
			counter.request();
			await Promise.resolve();
			await vi.runAllTimersAsync();
			expect(onResult).toHaveBeenCalledOnce();
			counter.dispose();
			expect(h.listeners.size).toBe(0);
			counter.request();
			await vi.runAllTimersAsync();
			expect(onResult).toHaveBeenCalledOnce();
		} finally { vi.restoreAllMocks(); vi.useRealTimers(); }
	});
});
