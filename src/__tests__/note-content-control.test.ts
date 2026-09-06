import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { Component, TFile, type App } from "obsidian";
import { mountNoteContentControl } from "../note-content-control";
import { EDITABLE_PLACEHOLDER_ATTR, renderTemplate, templateHasEditableContent } from "../renderer";

let editor: EditorView | null = null;
afterEach(() => { editor?.destroy(); editor = null; window.document.body.replaceChildren(); });

function setup(template: string) {
	const container = window.document.body.appendChild(window.document.createElement("section"));
	const save = vi.fn();
	const update = mountNoteContentControl(container, () => editor);
	editor = new EditorView({ parent: container, state: EditorState.create({ doc: template, extensions: [
		history(), EditorView.updateListener.of(change => {
			if (change.docChanged) { save(change.state.doc.toString()); update(); }
		}),
	] }) });
	update();
	return { container, button: container.querySelector("button")!, save, editor };
}

describe("issue #17 note content control", () => {
	it("adds the body without replacing the layout, saves once, and supports undo", () => {
		const s = setup("<p>Hello World!</p>");
		expect(s.container.querySelector("p")?.textContent).toContain("does not include the note body");
		s.button.click(); s.button.click();
		expect(s.editor.state.doc.toString()).toBe("<p>Hello World!</p>\n{{file.content}}");
		expect(s.save).toHaveBeenCalledOnce();
		expect(s.button.disabled).toBe(true);
		undo(s.editor);
		expect(s.editor.state.doc.toString()).toBe("<p>Hello World!</p>");
		expect(s.button.disabled).toBe(false);
	});

	it.each(["{{file.content}}", "{{ content }}", "{{file.content | upper}}"])("does not duplicate existing %s", placeholder => {
		const s = setup(`<article>${placeholder}</article>`);
		expect(s.button.disabled).toBe(true);
		s.button.click(); expect(s.save).not.toHaveBeenCalled();
	});

	it("shows the reported Sample body in reading mode and supplies the live editor slot", async () => {
		const s = setup("<p>Hello World!</p>"); s.button.click();
		const template = s.editor.state.doc.toString();
		const app = { metadataCache: { getFileCache: () => null }, vault: {} } as unknown as App;
		const file = new TFile(); file.path = "Issue17.md";
		const reading = window.document.createElement("div");
		await renderTemplate(app, template, file, reading, new Component(), false, undefined, undefined, false, "Sample");
		expect(reading.textContent).toContain("Hello World!");
		expect(reading.textContent).toContain("Sample");
		expect(templateHasEditableContent(template)).toBe(true);
		const editing = window.document.createElement("div");
		await renderTemplate(app, template, file, editing, new Component(), true, undefined, undefined, false, "Sample");
		expect(editing.querySelector(`[${EDITABLE_PLACEHOLDER_ATTR}]`)).not.toBeNull();
		expect(editing.textContent).toContain("Hello World!");
	});
});
