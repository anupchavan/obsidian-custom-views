import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { codeFrame, COLLAPSE_MS, NEW_PROBLEM_DELAY, popoverGoesAbove, scriptErrorDiagnostic, setRuntimeDiagnostics } from "../editor-diagnostics";
import { analyzeEditorSource, createTemplateEditor } from "../editor";

const views: EditorView[] = [];
function editor(initialContent: string, language: "html" | "css" | "javascript" = "html") {
	const view = createTemplateEditor({ initialContent, language, templateVariables: [{ name: "photo", type: "text" }, { name: "cover", type: "text" }] });
	document.body.appendChild(view.dom);
	views.push(view);
	return view;
}
const banners = (view: EditorView) => Array.from(view.dom.querySelectorAll(".cv-issue-banner .cv-issue-message")).map(el => el.textContent);
const titles = (view: EditorView) => Array.from(view.dom.querySelectorAll(".cv-diagnostic-title")).map(el => el.textContent);
const type = (view: EditorView, from: number, to: number, insert: string) => view.dispatch({ changes: { from, to, insert } });

afterEach(() => {
	vi.useRealTimers();
	for (const view of views.splice(0)) { view.destroy(); view.dom.remove(); }
});

describe("inline diagnostics", () => {
	it("tints the line, underlines the range and puts the message in a banner", () => {
		const view = editor("<h1>{{ title }}</h1>\n<div>{{ cover | imag }}</div>");
		expect(banners(view)).toEqual(["No note has a property named title", "Unknown filter imag"]);
		const lines = view.dom.querySelectorAll(".cm-line");
		expect(lines[0].classList).toContain("cv-issue-line");
		expect(lines[0].classList).toContain("is-warning");
		expect(lines[1].classList).toContain("is-error");
		expect(lines[1].querySelector(".cv-issue-banner code")!.textContent).toBe("imag");
		expect(view.dom.querySelectorAll(".cv-diagnostic-mark.is-error")).toHaveLength(1);
		expect(view.dom.querySelectorAll(".cv-diagnostic-mark.is-warning")).toHaveLength(1);
		// Problems with a place in the code never take room under it.
		expect(view.dom.querySelector(".cv-diagnostics")).toBeNull();
	});

	it("counts several problems on one line and opens them all in a popover from the banner", () => {
		const view = editor("{{ covr }} {{ photo | imag }}");
		const banner = view.dom.querySelector<HTMLButtonElement>(".cv-issue-banner")!;
		expect(banner.querySelector(".cv-issue-count")!.textContent).toBe("2");
		expect(banner.getAttribute("aria-expanded")).toBe("false");
		banner.click();
		expect(view.dom.querySelector(".cv-issue-banner")!.getAttribute("aria-expanded")).toBe("true");
		// The popover lives on the page's body, so an ancestor can't clip it.
		expect(view.dom.querySelector(".cv-issue-popover")).toBeNull();
		const details = document.querySelectorAll(".cm-tooltip.cv-issue-popover .cv-issue-detail");
		expect(Array.from(details, item => item.querySelector(".cv-issue-detail-title")!.textContent)).toEqual(["No note has a property named covr", "Unknown filter imag"]);
		expect(details[1].querySelector(".cv-issue-hint code")!.textContent).toBe("image");
		view.dom.querySelector<HTMLButtonElement>(".cv-issue-banner")!.click();
		expect(document.querySelector(".cv-issue-popover")).toBeNull();
	});

	it("closes the popover on a click elsewhere, on Escape and on typing", () => {
		const view = editor("{{ covr }}\n<p></p>");
		const open = () => view.dom.querySelector<HTMLButtonElement>(".cv-issue-banner")!.click();
		const isOpen = () => document.querySelector(".cv-issue-popover") !== null;
		open();
		document.querySelector(".cv-issue-popover")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(isOpen()).toBe(true);
		view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(isOpen()).toBe(false);
		open();
		view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(isOpen()).toBe(false);
		open();
		type(view, 11, 11, "x");
		expect(isOpen()).toBe(false);
	});

	it("selects the problem when its message is clicked", () => {
		const source = "{{ PHOTO }}";
		const view = editor(source);
		view.dom.querySelector<HTMLButtonElement>(".cv-issue-banner")!.click();
		document.querySelector<HTMLButtonElement>(".cv-issue-detail-title")!.click();
		expect(view.state.selection.main.from).toBe(source.indexOf("PHOTO"));
		expect(view.state.selection.main.to).toBe(source.indexOf("PHOTO") + 5);
	});

	it("clears a fixed problem at once but waits before showing a new one", () => {
		vi.useFakeTimers();
		const view = editor("{{ cover | imag }}");
		view.dom.querySelector<HTMLButtonElement>(".cv-issue-banner")!.click();
		type(view, 15, 15, "e");
		vi.advanceTimersByTime(0);
		expect(banners(view)).toEqual([]);
		expect(view.dom.querySelector(".cv-issue-line, .cv-diagnostic-mark")).toBeNull();
		expect(document.querySelector(".cv-issue-popover")).toBeNull();

		type(view, 3, 8, "covr");
		vi.advanceTimersByTime(NEW_PROBLEM_DELAY - 1);
		expect(banners(view)).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(banners(view)).toEqual(["No note has a property named covr"]);
		expect(document.querySelector(".cv-issue-popover")).toBeNull();
	});

	it("keeps runtime errors on the code until replaced", () => {
		const view = editor("const a = 1;\nnull.foo;", "javascript");
		view.dispatch({ effects: setRuntimeDiagnostics.of([{ from: 13, to: 17, severity: "error", message: "TypeError: boom", hint: "Thrown when the preview ran this on Dune." }]) });
		expect(view.dom.querySelectorAll(".cm-line")[1].querySelector(".cv-issue-banner")!.textContent).toBe("TypeError: boom");
		type(view, 0, 0, "\n");
		expect(view.dom.querySelectorAll(".cm-line")[2].querySelector(".cv-issue-banner")!.textContent).toBe("TypeError: boom");
		view.dispatch({ effects: setRuntimeDiagnostics.of([]) });
		expect(banners(view)).toEqual([]);
	});

	it("lists errors with no place in the code under it, and folds the list away once they're gone", () => {
		vi.useFakeTimers();
		const view = editor("const a = 1;", "javascript");
		view.dispatch({ effects: setRuntimeDiagnostics.of([{ severity: "error", message: "Error: lost", hint: "Thrown when the preview ran this on Dune." }]) });
		expect(view.dom.querySelector(".cm-panels-bottom .cv-diagnostics")!.getAttribute("role")).toBe("status");
		expect(titles(view)).toEqual(["Error: lost"]);
		view.dispatch({ effects: setRuntimeDiagnostics.of([]) });
		expect(view.dom.querySelector(".cv-diagnostics-collapsing")).not.toBeNull();
		vi.advanceTimersByTime(COLLAPSE_MS);
		expect(view.dom.querySelector(".cv-diagnostics")).toBeNull();
	});

	it("checks CSS and JavaScript syntax in their editors", () => {
		expect(analyzeEditorSource("css", ".a { color red; }", []).map(d => d.message)).toEqual(["Expected `:` after `color`"]);
		expect(analyzeEditorSource("javascript", "const a = ;", []).map(d => d.message)).toEqual(["Unexpected token ';'"]);
		expect(analyzeEditorSource("html", ".a { color red; }", [])).toEqual([]);
	});
});

describe("popoverGoesAbove", () => {
	const editor = { top: 0, bottom: 300 };
	it("opens below when it fits inside the editor there", () => {
		expect(popoverGoesAbove({ top: 40, bottom: 60 }, editor, 100, 900)).toBe(false);
	});
	it("opens above on the last lines, where only the space above fits it", () => {
		expect(popoverGoesAbove({ top: 260, bottom: 280 }, editor, 100, 900)).toBe(true);
	});
	it("takes the side of the window with more room when neither fits", () => {
		expect(popoverGoesAbove({ top: 140, bottom: 160 }, editor, 200, 900)).toBe(false);
		expect(popoverGoesAbove({ top: 700, bottom: 720 }, { top: 600, bottom: 800 }, 300, 900)).toBe(true);
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
