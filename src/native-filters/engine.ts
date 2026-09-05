import type { App, FrontMatterCache, TFile } from "obsidian";
import type { ViewConfig } from "../types";
import { checkRules } from "../matcher";
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
	matches(view: ViewConfig, file: TFile, frontmatter?: FrontMatterCache): boolean {
		if (view.basesFilters === undefined) return checkRules(this.app, view.rules, file, frontmatter);
		if (view.basesFilters === null) return true;
		if (!this.api) { this.recover(); return false; }
		const key = JSON.stringify(view.basesFilters);
		try {
			if (!this.cache.has(key)) {
				const filter = this.api.parse(view.basesFilters).filters ?? null;
				this.cache.set(key, filter);
				if (this.cache.size > 128) {
					const oldest: unknown = this.cache.keys().next().value;
					if (typeof oldest === "string") this.cache.delete(oldest);
				}
			}
			const filter = this.cache.get(key);
			return !filter || (!filter.hasError() && this.api.test(filter, file));
		} catch { return false; }
	}
}
