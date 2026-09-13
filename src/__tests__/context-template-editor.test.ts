import { afterEach, expect, it, vi } from "vitest";
import type { ViewConfig } from "../types";

// Obsidian's setValue invokes onChange; context switches must not save overrides.
const controls = vi.hoisted(() => ({ open: undefined as undefined | (() => void), dropdown: undefined as undefined | ((value: string) => void), toggles: [] as Array<(value: boolean) => void> }));
vi.mock("obsidian", async importOriginal => ({
	...await importOriginal<typeof import("obsidian")>(),
	SettingGroup: undefined,
	Setting: class {
		settingEl: HTMLElement;
		infoEl: HTMLElement;
		controlEl: HTMLElement;
		constructor(host: HTMLElement) {
			this.settingEl = host.appendChild(document.createElement("div"));
			this.infoEl = this.settingEl.appendChild(document.createElement("div"));
			this.controlEl = this.settingEl.appendChild(document.createElement("div"));
			this.controlEl.addClass = (...classes) => this.controlEl.classList.add(...classes);
		}
		setHeading() { return this; } setName() { return this; } setDesc() { return this; }
		addButton(callback: (control: unknown) => void) {
			const control = { setButtonText: () => control, onClick: (fn: () => void) => { controls.open = fn; return control; } };
			callback(control); return this;
		}
		addDropdown(callback: (control: unknown) => void) {
			const control = { addOptions: () => control, onChange(fn: (value: string) => void) { controls.dropdown = fn; return control; } };
			callback(control); return this;
		}
		addToggle(callback: (control: unknown) => void) {
			let current = false, changed: (value: boolean) => void = () => {};
			const control = { onChange(fn: typeof changed) { changed = fn; }, setValue(value: boolean) { if (current !== value) { current = value; changed(value); } } };
			controls.toggles.push(value => control.setValue(value)); callback(control); return this;
		}
	},
}));
import { mountContextTemplateEditors } from "../context-template-editor";

afterEach(() => { controls.toggles = []; window.document.body.replaceChildren(); });
it("switches contexts without saving, isolates edits, and inherits each language separately", () => {
	const host = window.document.createElement("div");
	host.createEl = (tag, options) => { const el = createEl(tag, options); host.append(el); return el; };
	host.createDiv = options => host.createEl("div", options);
	const config = { template: "Main", css: "body {}", js: "" } as ViewConfig;
	const save = vi.fn();
	const open = vi.fn();
	const editors = mountContextTemplateEditors(host, config, [], true, save, open);
	try {
		controls.open!(); expect(open).toHaveBeenLastCalledWith("note");
		controls.dropdown!("popover");
		controls.open!(); expect(open).toHaveBeenLastCalledWith("popover");
		expect(save).not.toHaveBeenCalled(); expect(config.contexts).toBeUndefined();
		expect(editors.templateEditor.state.readOnly).toBe(true);
		controls.toggles[1](false);
		expect(editors.cssEditor.state.readOnly).toBe(false);
		editors.cssEditor.dispatch({ changes: { from: 0, to: editors.cssEditor.state.doc.length, insert: ".compact {}" } });
		expect(config.contexts).toEqual({ popover: { css: ".compact {}" } });
		expect(config.css).toBe("body {}");
		controls.dropdown!("canvas"); expect(editors.cssEditor.state.doc.toString()).toBe("body {}");
		controls.dropdown!("popover"); expect(editors.cssEditor.state.doc.toString()).toBe(".compact {}");
		controls.toggles[1](true); expect(config.contexts?.popover?.css).toBeUndefined();
		expect(editors.cssEditor.state.doc.toString()).toBe("body {}");
	} finally { Object.values(editors).forEach(editor => editor.destroy()); }
});
