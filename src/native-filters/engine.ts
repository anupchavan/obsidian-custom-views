import type { App, TFile } from "obsidian";
import type { ViewConfig } from "../types";
import { getNativeBasesApi, type BasesFilter, type NativeBasesApi, type ParsedFilter } from "./api";
import { toBasesFilter } from "./convert";

/** A view's Bases filters. Legacy rules convert in memory; data.json changes only when the view is edited. */
export function viewFilters(app: App, view: ViewConfig): BasesFilter | null {
	return view.basesFilters === undefined ? toBasesFilter(app, view.rules) : view.basesFilters;
}

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
	matches(view: ViewConfig, file: TFile): boolean {
		if (view.enabled === false) return false;
		const filters = viewFilters(this.app, view);
		if (filters === null) return true;
		if (!this.api) { this.recover(); return false; }
		const key = JSON.stringify(filters);
		try {
			if (!this.cache.has(key)) {
				const filter = this.api.parse(filters).filters ?? null;
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
