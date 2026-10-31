import type { App, FrontMatterCache, TFile } from "obsidian";
import type { ViewConfig } from "../types";
import { checkRules } from "../matcher";
import type { RuleTest } from "../match-counts";
import { getNativeBasesApi, type NativeBasesApi, type ParsedFilter } from "./api";

export class NativeRuleEngine {
	private api: NativeBasesApi | null = null;
	private cache = new Map<string, ParsedFilter | null>();
	private recovering = false;
	constructor(private app: App, private onReady: () => void = () => {}) {}
	async prepare(): Promise<void> { this.api = await getNativeBasesApi(this.app); }
	private recover(): void {
		if (this.recovering) return;
		this.recovering = true;
		void this.prepare().then(() => this.onReady()).catch(() => {
			// Bases may still be disabled. Retry on the next matching request.
		}).finally(() => { this.recovering = false; });
	}
	private parsed(filters: NonNullable<ViewConfig["basesFilters"]>): ParsedFilter | null {
		const key = JSON.stringify(filters);
		if (!this.cache.has(key)) {
			const filter = this.api!.parse(filters).filters ?? null;
			this.cache.set(key, filter);
			if (this.cache.size > 128) {
				const oldest: unknown = this.cache.keys().next().value;
				if (typeof oldest === "string") this.cache.delete(oldest);
			}
		}
		return this.cache.get(key) ?? null;
	}
	matches(view: ViewConfig, file: TFile, frontmatter?: FrontMatterCache): boolean {
		if (view.enabled === false) return false;
		if (view.basesFilters === undefined) return checkRules(this.app, view.rules, file, frontmatter);
		if (view.basesFilters === null) return true;
		if (!this.api) { this.recover(); return false; }
		try {
			const filter = this.parsed(view.basesFilters);
			return !filter || (!filter.hasError() && this.api.test(filter, file));
		} catch { return false; }
	}
	/**
	 * The view's rules, resolved once for a pass over many notes, ignoring whether
	 * the view is enabled. Null while the Bases API is unavailable.
	 */
	compile(view: ViewConfig): RuleTest | null {
		const never: RuleTest = { all: false, test: () => false };
		if (view.basesFilters === undefined) {
			const rules = view.rules;
			if (!rules?.conditions?.length) return { all: true, test: () => true };
			return { all: false, test: (file, frontmatter) => checkRules(this.app, rules, file, frontmatter) };
		}
		const filters = view.basesFilters;
		if (filters === null || (typeof filters === "object" && "and" in filters && filters.and.length === 0)) return { all: true, test: () => true };
		const api = this.api;
		if (!api) return null;
		try {
			const filter = this.parsed(filters);
			if (!filter) return { all: true, test: () => true };
			if (filter.hasError()) return never;
			return { all: false, test: file => { try { return api.test(filter, file); } catch { return false; } } };
		} catch { return never; }
	}
}
