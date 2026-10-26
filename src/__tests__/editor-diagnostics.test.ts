import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { codeFrame, COLLAPSE_MS, NEW_PROBLEM_DELAY, scriptErrorDiagnostic, setRuntimeDiagnostics } from "../editor-diagnostics";
import { analyzeEditorSource, createTemplateEditor } from "../editor";

const views: EditorView[] = [];
function editor(initialContent: string, language: "html" | "css" | "javascript" = "html") {
	const view = createTemplateEditor({ initialContent, language, templateVariables: [{ name: "photo", type: "text" }, { name: "cover", type: "text" }] });
	document.body.appendChild(view.dom);
	views.push(view);
	return view;
}
const titles = (view: EditorView) => Array.from(view.dom.querySelectorAll(".cv-diagnostic-title")).map(el => el.textContent);
const type = (view: EditorView, from: number, to: number, insert: string) => view.dispatch({ changes: { from, to, insert } });

afterEach(() => {
	vi.useRealTimers();
	for (const view of views.splice(0)) { view.destroy(); view.dom.remove(); }
});

describe("diagnostics panel", () => {
	it("lists problems below the code with location, frame and hint", () => {
		const view = editor("<h1>{{ title }}</h1>\n<div>{{ cover | imag }}</div>");
		const panel = view.dom.querySelector(".cm-panels-bottom .cv-diagnostics")!;
		expect(panel.getAttribute("role")).toBe("status");
		expect(titles(view)).toEqual(["Line 1, column 8: No note has a property named title", "Line 2, column 17: Unknown filter imag"]);
		const item = panel.querySelectorAll(".cv-diagnostic")[1];
		expect(item.classList).toContain("is-error");
		expect(item.querySelector(".cv-diagnostic-frame")!.textContent).toBe("<div>{{ cover | imag }}</div>\n                ^^^^");
		expect(item.querySelector(".cv-diagnostic-hint code")!.textContent).toBe("image");
		expect(view.dom.querySelectorAll(".cv-diagnostic-mark.is-error")).toHaveLength(1);
		expect(view.dom.querySelectorAll(".cv-diagnostic-mark.is-warning")).toHaveLength(1);
	});

	it("shows no panel for clean code", () => {
		const view = editor("<h1>{{ file.basename }}</h1>");
		expect(view.dom.querySelector(".cv-diagnostics")).toBeNull();
	});

	it("selects the problem when its title is clicked", () => {
		const source = "{{ PHOTO }}";
		const view = editor(source);
		view.dom.querySelector<HTMLButtonElement>("button.cv-diagnostic-title")!.click();
		expect(view.state.selection.main.from).toBe(source.indexOf("PHOTO"));
		expect(view.state.selection.main.to).toBe(source.indexOf("PHOTO") + 5);
	});

	it("clears a fixed problem at once but waits before showing a new one", () => {
		vi.useFakeTimers();
		const view = editor("{{ cover | imag }}");
		type(view, 15, 15, "e");
		vi.advanceTimersByTime(0);
		expect(view.dom.querySelector(".cv-diagnostic-mark")).toBeNull();
		// The list folds away instead of vanishing, so the code doesn't jump.
		expect(view.dom.querySelector(".cv-diagnostics-collapsing")).not.toBeNull();
		vi.advanceTimersByTime(COLLAPSE_MS);
		expect(view.dom.querySelector(".cv-diagnostics")).toBeNull();

		type(view, 3, 8, "covr");
		vi.advanceTimersByTime(NEW_PROBLEM_DELAY - 1);
		expect(view.dom.querySelector(".cv-diagnostics")).toBeNull();
		vi.advanceTimersByTime(1);
		expect(titles(view)).toEqual(["Line 1, column 4: No note has a property named covr"]);
	});

	it("keeps the list open when a new problem arrives while it folds away", () => {
		vi.useFakeTimers();
		const view = editor("{{ cover | imag }}");
		type(view, 15, 15, "e");
		vi.advanceTimersByTime(0);
		type(view, 3, 8, "covr");
		vi.advanceTimersByTime(NEW_PROBLEM_DELAY);
		expect(view.dom.querySelector(".cv-diagnostics-collapsing")).toBeNull();
		expect(titles(view)).toEqual(["Line 1, column 4: No note has a property named covr"]);
	});

	it("keeps runtime errors on the code until replaced", () => {
		vi.useFakeTimers();
		const view = editor("const a = 1;\nnull.foo;", "javascript");
		view.dispatch({ effects: setRuntimeDiagnostics.of([{ from: 13, to: 17, severity: "error", message: "TypeError: boom", hint: "Thrown when the preview ran this on Dune." }]) });
		expect(titles(view)).toEqual(["Line 2, column 1: TypeError: boom"]);
		type(view, 0, 0, "\n");
		expect(titles(view)).toEqual(["Line 3, column 1: TypeError: boom"]);
		view.dispatch({ effects: setRuntimeDiagnostics.of([]) });
		vi.advanceTimersByTime(COLLAPSE_MS);
		expect(view.dom.querySelector(".cv-diagnostics")).toBeNull();
	});

	it("checks CSS and JavaScript syntax in their editors", () => {
		expect(analyzeEditorSource("css", ".a { color red; }", []).map(d => d.message)).toEqual(["Expected `:` after `color`"]);
		expect(analyzeEditorSource("javascript", "const a = ;", []).map(d => d.message)).toEqual(["Unexpected token ';'"]);
		expect(analyzeEditorSource("html", ".a { color red; }", [])).toEqual([]);
	});
});

describe("codeFrame", () => {
	it("dedents and keeps the caret under the problem", () => {
		expect(codeFrame("\t\t{{ covr }}", 5, 9)).toEqual({ text: "{{ covr }}", caretAt: 3, caretLength: 4 });
	});

	it("windows long lines around the problem", () => {
		const line = `${"a".repeat(100)}{{ covr }}${"b".repeat(100)}`;
		const frame = codeFrame(line, 103, 107);
		expect(frame.text.startsWith("…") && frame.text.endsWith("…")).toBe(true);
		expect(frame.text.slice(frame.caretAt, frame.caretAt + frame.caretLength)).toBe("covr");
	});
});

describe("scriptErrorDiagnostic", () => {
	const thrown = (line: number, column: number) => Object.assign(new TypeError("boom"), { stack: `TypeError: boom\n    at eval (eval at x (main.js:1:1), <anonymous>:${line + 3}:${column})` });

	it("places view script errors on the author's line", () => {
		const text = "const a = 1;\nnull.foo;";
		const diagnostic = scriptErrorDiagnostic(thrown(2, 6), { kind: "view" }, text, "Dune");
		expect(diagnostic).toMatchObject({ from: 18, message: "TypeError: boom", hint: "Thrown when the preview ran this on Dune." });
		expect(text.slice(diagnostic.from, diagnostic.to)).toBe("foo");
	});

	it("finds inline script errors inside the template", () => {
		const text = "<p>Hi</p>\n<script>\nlet x;\nx.y();\n</script>";
		const diagnostic = scriptErrorDiagnostic(thrown(2, 3), { kind: "inline", code: "let x;\nx.y();" }, text, "Dune");
		expect(text.slice(diagnostic.from, diagnostic.to)).toBe("y");
	});

	it("keeps the message when the location is unknown", () => {
		expect(scriptErrorDiagnostic("plain failure", { kind: "view" }, "", "Dune")).toEqual({ severity: "error", message: "Error: plain failure", hint: "Thrown when the preview ran this on Dune." });
	});
});
