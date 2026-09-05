import type { App } from "obsidian";
import type { ViewConfig } from "../types";
import { getNativeBasesApi } from "./api";
import { toBasesFilter } from "./convert";

/** Own the native widget for exactly the lifetime of its settings modal. */
export function mountNativeFilters(app: App, host: HTMLElement, view: ViewConfig, save: () => void): () => void {
	let closed = false;
	let pending = false;
	let dispose: (() => void) | undefined;
	const mount = () => {
		if (closed || pending || dispose) return;
		pending = true;
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
			if (closed) return;
			host.replaceChildren();
			const message = host.ownerDocument.createElement("p");
			message.setAttribute("role", "alert");
			message.textContent = error instanceof Error ? error.message : "The Bases filter editor could not be loaded.";
			const retry = host.ownerDocument.createElement("button");
			retry.type = "button";
			retry.textContent = "Retry";
			retry.addEventListener("click", mount);
			host.append(message, retry);
		}).finally(() => { pending = false; });
	};
	mount();
	return () => {
		if (closed) return;
		closed = true;
		dispose?.();
		host.replaceChildren();
	};
}
