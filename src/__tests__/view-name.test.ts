import { afterEach, expect, it, vi } from "vitest";
import type { App, Scope, Setting } from "obsidian";
import { conflictingView, copyViewName, renameViewInline } from "../view-name";
import type { ViewConfig } from "../types";

afterEach(() => document.body.replaceChildren());

it("selects the name, rejects conflicts with native feedback, and cancels without saving", () => {
	const views = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }] as ViewConfig[];
	const nameEl = document.body.appendChild(document.createElement("div"));
	nameEl.textContent = "Alpha";
	const other = document.body.appendChild(document.createElement("div"));
	let scope!: Scope;
	const popScope = vi.fn();
	const app = { scope: {}, keymap: { pushScope(value: Scope) { scope = value; }, popScope } } as unknown as App;
	const setting = { nameEl, setName(name: string) { nameEl.textContent = name; } } as unknown as Setting;
	const save = vi.fn();
	const cancel = renameViewInline(app, setting, views[0], views, () => other, save);
	const input = nameEl;
	expect(nameEl.querySelector("input")).toBeNull();
	expect(window.getSelection()?.toString()).toBe("Alpha");
	const press = (key: string, isComposing = false) => {
		const keys = Reflect.get(scope, "keys") as { key: string; func(event: { isComposing: boolean }): void }[];
		keys.find(handler => handler.key === key)!.func({ isComposing });
	};
	input.textContent = " beta "; press("Enter");
	expect(views[0].name).toBe("Alpha");
	expect(other.classList.contains("multi-select-duplicate")).toBe(true);
	expect(input.getAttribute("aria-invalid")).toBe("true");
	press("Escape", true); expect(nameEl.contains(input)).toBe(true);
	press("Escape"); cancel();
	expect(nameEl.textContent).toBe("Alpha");
	expect(save).not.toHaveBeenCalled();
	expect(popScope).toHaveBeenCalledOnce();
});

it("commits a valid trimmed name on blur and releases its key scope", () => {
	const view = { id: "a", name: "Alpha" } as ViewConfig;
	const nameEl = document.body.appendChild(document.createElement("div"));
	nameEl.textContent = "Alpha";
	const popScope = vi.fn();
	const app = { scope: {}, keymap: { pushScope: vi.fn(), popScope } } as unknown as App;
	const setting = { nameEl, setName(name: string) { nameEl.textContent = name; } } as unknown as Setting;
	const save = vi.fn();
	renameViewInline(app, setting, view, [view], () => undefined, save);
	const input = nameEl;
	expect(nameEl.querySelector("input")).toBeNull();
	input.textContent = " Renamed "; input.dispatchEvent(new Event("blur"));
	expect(view.name).toBe("Renamed");
	expect(save).toHaveBeenCalledOnce();
	expect(popScope).toHaveBeenCalledOnce();
});

it("generates non-conflicting copy names without changing existing views", () => {
	const views = [{ name: "Alpha" }, { name: "ALPHA COPY" }, { name: "Alpha copy 2" }] as ViewConfig[];
	expect(copyViewName(views, "Alpha")).toBe("Alpha copy 3");
	expect(conflictingView(views, " alpha ", views[0])).toBeUndefined();
});
