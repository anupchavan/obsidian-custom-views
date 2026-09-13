import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { templateHighlighting } from "../editor-template-highlighting";
import { createTemplateEditorState } from "../editor";

function tokens(state: EditorState) {
	const result: [string, string][] = [];
	state.field(templateHighlighting).decorations.between(0, state.doc.length, (from, to, value) => {
		result.push([state.sliceDoc(from, to), value.spec.class]);
	});
	return result;
}

describe("Knap highlighting layered over host languages", () => {
	it("highlights filters inside HTML attributes and retains the HTML parser", () => {
		const state = createTemplateEditorState({ initialContent: '<img src="{{ backdrop | first }}"><p>{{ title | upper }}</p>' });
		expect(tokens(state)).toContainEqual(["first", "cv-syn-filter"]);
		expect(tokens(state)).toContainEqual(["upper", "cv-syn-filter"]);
		expect(tokens(state)).toContainEqual(["backdrop", "cv-syn-variable"]);
		const names: string[] = [];
		syntaxTree(state).iterate({ enter: node => { names.push(node.name); } });
		expect(names).toContain("TagName");
		expect(tokens(state).some(([value]) => value === "img")).toBe(false);
	});
	it("handles quotes, logical OR, multiline expressions and comments", () => {
		const state = EditorState.create({ doc: '{# {{ ignored | upper }} #}\n{% if a || b %}\n{{ title |\n replace:"a|b":"c" }}', extensions: [templateHighlighting] });
		const result = tokens(state);
		expect(result.filter(([, cls]) => cls === "cv-syn-filter")).toEqual([["replace", "cv-syn-filter"]]);
		expect(result).toContainEqual(['"a|b"', "cv-syn-string"]);
		expect(result).toContainEqual(["if", "cv-syn-keyword"]);
	});
	it("updates token ranges after edits but does no work on selection changes", () => {
		const state = EditorState.create({ doc: '{{ title | upper }}', extensions: [templateHighlighting] });
		const selected = state.update({ selection: { anchor: 2 } }).state;
		expect(selected.field(templateHighlighting)).toBe(state.field(templateHighlighting));
		const updated = state.update({ changes: { from: 11, to: 16, insert: 'lower' } }).state;
		expect(tokens(updated)).toContainEqual(["lower", "cv-syn-filter"]);
	});
	it("reuses shifted lines and propagates changed multiline token state", () => {
		const state = EditorState.create({ doc: '{{ title | upper }}\n{{ title | lower }}', extensions: [templateHighlighting] });
		const shifted = state.update({ changes: { from: 0, insert: 'Heading\n' } }).state;
		expect(shifted.field(templateHighlighting).lines[2]).toBe(state.field(templateHighlighting).lines[1]);
		const commented = state.update({ changes: { from: 0, insert: '{#' } }).state;
		expect(tokens(commented).every(([, cls]) => cls === "cv-syn-comment")).toBe(true);
	});

	it("retains CSS and JS parsing and skips pathological long lines", () => {
		for (const language of ["css", "javascript"] as const) {
			const state = createTemplateEditorState({ language, initialContent: language === "css" ? 'a { color: red; }' : 'const title = "hello";' });
			expect(syntaxTree(state).length).toBe(state.doc.length);
			expect(tokens(state)).toEqual([]);
		}
		const state = EditorState.create({ doc: 'x'.repeat(2001) + '{{ title | upper }}\n{{ title | lower }}', extensions: [templateHighlighting] });
		expect(tokens(state).filter(([, cls]) => cls === "cv-syn-filter")).toEqual([["lower", "cv-syn-filter"]]);
	});
});
