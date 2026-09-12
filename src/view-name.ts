import { Scope, type App, type Setting } from "obsidian";
import type { ViewConfig } from "./types";

export function conflictingView(views: readonly ViewConfig[], name: string, except?: ViewConfig): ViewConfig | undefined {
	const normalized = name.trim().toLowerCase();
	return views.find(view => view !== except && view.name.trim().toLowerCase() === normalized);
}

export function copyViewName(views: readonly ViewConfig[], name: string): string {
	const base = `${name} copy`;
	let candidate = base;
	for (let suffix = 2; conflictingView(views, candidate); suffix++) candidate = `${base} ${suffix}`;
	return candidate;
}

/** Edit the existing name, as the native file explorer does, without replacing its layout. */
export function renameViewInline(app: App, setting: Setting, view: ViewConfig, views: readonly ViewConfig[],
	findName: (id: string) => HTMLElement | undefined, save: () => void): (() => void) & { commit: () => void } {
	const input = setting.nameEl;
	input.setAttribute("contenteditable", "plaintext-only");
	input.setAttribute("role", "textbox");
	const button = setting.controlEl?.querySelector<HTMLElement>('[aria-label="Rename view"], [aria-label="View actions"]');
	button?.setAttribute("aria-pressed", "true");
	button?.classList.add("is-active");
	const events = new AbortController();
	// Keep the active editor focused until the toggle click commits it.
	button?.addEventListener("pointerdown", event => event.preventDefault(), { signal: events.signal });
	input.setAttribute("aria-label", "View name");
	let closed = false;
	let scoped = false;
	const scope = new Scope(app.scope);
	const popScope = () => { if (scoped) { app.keymap.popScope(scope); scoped = false; } };
	const finish = (restoreFocus = false) => {
		if (closed) return;
		closed = true;
		popScope();
		events.abort();
		for (const attribute of ["contenteditable", "role", "aria-label", "aria-invalid"]) input.removeAttribute(attribute);
		button?.setAttribute("aria-pressed", "false");
		button?.classList.remove("is-active");
		setting.setName(view.name);
		if (restoreFocus) setting.controlEl?.querySelector<HTMLElement>('[aria-label="Rename view"], [aria-label="View actions"]')?.focus();
	};
	const commit = (restoreFocus = false) => {
		if (closed) return;
		const name = (input.textContent ?? "").trim();
		if (!name) { finish(restoreFocus); return; }
		const conflict = conflictingView(views, name, view);
		if (conflict) {
			input.setAttribute("aria-invalid", "true");
			const existing = findName(conflict.id);
			if (existing && !existing.classList.contains("multi-select-duplicate")) {
				existing.classList.add("multi-select-duplicate");
				existing.addEventListener("animationend", () => existing.classList.remove("multi-select-duplicate"), { once: true });
			}
			return;
		}
		const changed = view.name !== name;
		view.name = name;
		finish(restoreFocus);
		if (changed) save();
	};
	scope.register([], "Escape", event => {
		if (event.isComposing) return;
		finish(true); return false;
	});
	scope.register([], "Enter", event => {
		if (event.isComposing) return;
		commit(true); return false;
	});
	input.addEventListener("focus", () => { if (!scoped && !closed) { app.keymap.pushScope(scope); scoped = true; } }, { signal: events.signal });
	input.addEventListener("blur", () => { popScope(); commit(); }, { signal: events.signal });
	input.addEventListener("input", () => input.removeAttribute("aria-invalid"), { signal: events.signal });
	input.focus({ preventScroll: true });
	const range = input.ownerDocument.createRange();
	range.selectNodeContents(input);
	const selection = input.ownerDocument.defaultView?.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
	// A background window can update activeElement without firing focus yet.
	if (!scoped) { app.keymap.pushScope(scope); scoped = true; }
	return Object.assign(finish, { commit: () => commit(true) });
}
