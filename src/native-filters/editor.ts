import type { App } from "obsidian";
import type { ViewConfig } from "../types";
import { getNativeBasesApi } from "./api";
import { toBasesFilter } from "./convert";

/** Own the native widget for exactly the lifetime of its settings modal. */
export function mountNativeFilters(app: App, host: HTMLElement, view: ViewConfig, save: () => void): () => void {
	let closed = false;
	let dispose: (() => void) | undefined;
	host.textContent = "Loading filters…";
	void getNativeBasesApi(app).then(api => {
		if (closed) return;
		const filters = view.basesFilters === undefined ? toBasesFilter(app, view.rules) : view.basesFilters;
		dispose = api.createEditor(host, filters, value => {
			if (closed) return;
			view.basesFilters = value;
			save();
		});
	}).catch(error => {
		if (!closed) host.textContent = error instanceof Error ? error.message : "The Bases filter editor could not be loaded.";
	});
	return () => { closed = true; dispose?.(); host.replaceChildren(); };
}
