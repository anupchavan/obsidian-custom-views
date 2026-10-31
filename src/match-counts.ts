import type { App, EventRef, Events, FrontMatterCache, TFile } from "obsidian";
import type { ViewConfig } from "./types";

/** One view's rules, prepared once for a pass over many notes. */
export interface RuleTest {
	/** The view has no rules, so it matches every note. */
	all: boolean;
	test(file: TFile, frontmatter?: FrontMatterCache): boolean;
}

export interface ViewTally {
	off: boolean;
	all: boolean;
	/** Its rules need the Bases core plugin, which isn't available. */
	unavailable: boolean;
	/** Notes this view renders on. */
	wins: number;
	/** Notes its rules match. For an enabled view, wins plus lost. */
	matches: number;
	/** Notes its rules match that an enabled view above takes first. */
	lost: number;
	/** The view above that takes the most of them, or -1. */
	topTaker: number;
	/** How many views above take some of them. */
	takers: number;
}

export interface CountLine { text: string; tone: "muted" | "warning" | "faint" }

/**
 * Tallies first-match ownership over the vault, a slice at a time. It keeps
 * integers only: per view, and per pair of views for "goes to" counts.
 */
export class MatchPass {
	private index = 0;
	private readonly wins: Uint32Array;
	private readonly matches: Uint32Array;
	private readonly taken: Uint32Array;

	constructor(
		private readonly files: readonly TFile[],
		private readonly frontmatter: (file: TFile) => FrontMatterCache | undefined,
		private readonly tests: readonly (RuleTest | null)[],
		private readonly enabled: readonly boolean[],
	) {
		const count = tests.length;
		this.wins = new Uint32Array(count);
		this.matches = new Uint32Array(count);
		this.taken = new Uint32Array(count * count);
	}

	/** Work until `deadline` (from `now`); true once every note is counted. */
	step(deadline: number, now: () => number): boolean {
		const { files, tests, enabled } = this;
		const count = tests.length;
		while (this.index < files.length) {
			// Check the clock every 64 notes, not every note.
			const stop = Math.min(files.length, this.index + 64);
			for (; this.index < stop; this.index++) {
				const file = files[this.index];
				let frontmatter: FrontMatterCache | undefined;
				let read = false;
				let owner = -1;
				for (let view = 0; view < count; view++) {
					const rule = tests[view];
					if (!rule) continue;
					if (!rule.all) {
						if (!read) { frontmatter = this.frontmatter(file); read = true; }
						if (!rule.test(file, frontmatter)) continue;
					}
					this.matches[view]++;
					if (!enabled[view]) continue;
					if (owner < 0) { owner = view; this.wins[view]++; }
					else this.taken[view * count + owner]++;
				}
			}
			if (now() >= deadline) return this.index >= files.length;
		}
		return true;
	}

	result(): ViewTally[] {
		const count = this.tests.length;
		return this.tests.map((rule, view) => {
			let lost = 0, topTaker = -1, takers = 0;
			for (let above = 0; above < view; above++) {
				const taken = this.taken[view * count + above];
				if (!taken) continue;
				lost += taken;
				takers++;
				if (topTaker < 0 || taken > this.taken[view * count + topTaker]) topTaker = above;
			}
			return {
				off: !this.enabled[view], all: rule?.all ?? false, unavailable: rule === null,
				wins: this.wins[view], matches: this.matches[view], lost, topTaker, takers,
			};
		});
	}
}

const notes = (count: number) => `${count.toLocaleString()} ${count === 1 ? "note" : "notes"}`;

/** The second line under a view's name. Each line describes only its own view. */
export function describeTally(tally: ViewTally, views: readonly ViewConfig[]): CountLine {
	if (tally.unavailable) return { text: "Rules need the Bases core plugin", tone: "warning" };
	if (tally.off) return { text: `Off · ${notes(tally.matches)}`, tone: "faint" };
	const taker = views[tally.topTaker]?.name ?? "";
	const others = tally.takers > 1 ? ` and ${tally.takers - 1} ${tally.takers === 2 ? "other" : "others"}` : "";
	const goes = tally.lost === 1 ? "goes" : "go";
	if (tally.wins === 0 && tally.lost > 0) {
		const lost = tally.lost === 1 ? "1" : `all ${tally.lost.toLocaleString()}`;
		return { text: `0 notes · ${lost} ${goes} to ${taker}${others}`, tone: "warning" };
	}
	if (tally.all) return { text: `No rules · ${notes(tally.wins)}`, tone: "muted" };
	if (tally.wins === 0) return { text: "No matching notes", tone: "muted" };
	if (tally.lost > 0) return { text: `${notes(tally.wins)} · ${tally.lost.toLocaleString()} more ${goes} to ${taker}${others}`, tone: "muted" };
	return { text: notes(tally.wins), tone: "muted" };
}

/** Write a line into its slot, touching the DOM only when it changed. */
export function showCountLine(slot: HTMLElement, line: CountLine | undefined): void {
	const text = line?.text ?? " ";
	if (slot.textContent !== text) slot.setText(text);
	const tone = line?.tone ?? "muted";
	if (slot.dataset.cvTone !== tone) slot.dataset.cvTone = tone;
	slot.toggleClass("mod-warning", tone === "warning");
}

export interface CounterHost {
	app: App;
	views(): readonly ViewConfig[];
	compile(view: ViewConfig): RuleTest | null;
	/** Ask for the Bases API again after it was unavailable. */
	retry(): Promise<void>;
}

/** Synchronous budget before the first paint, so small vaults never show a late count. */
const FIRST_SLICE_MS = 8;
const SLICE_MS = 5;
/** Quiet time after vault changes before recounting. */
const VAULT_SETTLE_MS = 1000;

/**
 * Recounts on request while a settings surface is open. Only the newest pass
 * reports; a newer request cancels an older pass mid-way.
 */
export class MatchCounter {
	private generation = 0;
	private queued = false;
	private timer: number | undefined;
	private sliceTimer: number | undefined;
	private refs: [Events, EventRef][] = [];
	private retried = false;
	private disposed = false;

	constructor(private host: CounterHost, private onResult: (tallies: ViewTally[], views: readonly ViewConfig[]) => void) {
		const { metadataCache, vault } = host.app;
		const later = () => this.request(VAULT_SETTLE_MS);
		this.refs = [
			[metadataCache, metadataCache.on("changed", later)],
			...(["create", "delete", "rename"] as const).map(name => [vault, vault.on(name as "create", later)] as [Events, EventRef]),
		];
	}

	/** Recount now (before the next paint), or after `delay` ms of quiet. */
	request(delay = 0): void {
		if (this.disposed) return;
		window.clearTimeout(this.timer);
		this.timer = undefined;
		if (delay > 0) {
			this.timer = window.setTimeout(() => { this.timer = undefined; this.start(); }, delay);
			return;
		}
		if (this.queued) return;
		this.queued = true;
		queueMicrotask(() => { this.queued = false; this.start(); });
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.generation++;
		window.clearTimeout(this.timer);
		window.clearTimeout(this.sliceTimer);
		for (const [events, ref] of this.refs) events.offref(ref);
		this.refs = [];
	}

	private start(): void {
		if (this.disposed) return;
		const generation = ++this.generation;
		window.clearTimeout(this.sliceTimer);
		const views = [...this.host.views()];
		const tests = views.map(view => this.host.compile(view));
		const { metadataCache, vault } = this.host.app;
		const pass = new MatchPass(vault.getMarkdownFiles(), file => metadataCache.getFileCache(file)?.frontmatter,
			tests, views.map(view => view.enabled !== false));
		const now = () => performance.now();
		const run = (budget: number) => {
			if (generation !== this.generation) return;
			if (!pass.step(now() + budget, now)) {
				this.sliceTimer = window.setTimeout(() => run(SLICE_MS), 0);
				return;
			}
			this.onResult(pass.result(), views);
			if (tests.includes(null) && !this.retried) {
				this.retried = true;
				void this.host.retry().then(() => this.request(), () => {});
			}
		};
		run(FIRST_SLICE_MS);
	}
}
