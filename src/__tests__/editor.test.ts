/**
 * Tests for src/editor.ts
 *
 * Covers:
 *   - Theme configuration (Obsidian CSS variables only)
 *   - createTemplateEditor — creation, initial content, onChange callback
 *   - setEditorContent — replacing editor content
 *   - Editor extensions (line numbers, HTML highlighting, etc.)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
	themeConfig,
	obsidianTheme,
	obsidianExtension,
	buildEditorExtensions,
	createTemplateEditor,
	setEditorContent,
} from "../editor";
import { EditorView } from "@codemirror/view";
import { startCompletion, currentCompletions, completionStatus } from "@codemirror/autocomplete";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an editor and ensure it is destroyed after the test. */
const editors: EditorView[] = [];
function createAndTrack(
	opts: Parameters<typeof createTemplateEditor>[0]
): EditorView {
	const view = createTemplateEditor(opts);
	editors.push(view);
	return view;
}

afterEach(() => {
	for (const v of editors) v.destroy();
	editors.length = 0;
});

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

describe("theme", () => {
	it("maps every syntax colour to an Obsidian CSS variable", () => {
		expect(themeConfig).toMatchObject({
			dark: false,
			background: "var(--background-primary)",
			foreground: "var(--text-normal)",
			selection: "var(--text-selection)",
			cursor: "var(--text-normal)",
			matchingBracket: "var(--background-modifier-hover)",
			keyword: "var(--color-green)",
			class: "var(--code-property)",
			comment: "var(--code-comment)",
			tag: "var(--code-tag)",
			attribute: "var(--code-property)",
			string: "var(--color-cyan)",
			function: "var(--color-orange)",
			operator: "var(--text-muted)",
			number: "var(--color-purple)",
			constant: "var(--color-yellow)",
		});
		const syntaxKeys = [
			"keyword", "storage", "variable", "parameter", "function",
			"string", "constant", "type", "class", "number", "comment",
			"heading", "regexp", "tag", "attribute", "operator", "punctuation",
			"important",
		] as const;
		for (const key of syntaxKeys) {
			expect(themeConfig[key]).toMatch(/^var\(--/);
		}
	});

	it("bundles the theme and highlight style into one extension", () => {
		expect(obsidianExtension).toEqual([obsidianTheme, expect.anything()]);
	});

	it.each(["html", "css", "javascript"] as const)("builds a non-empty extension list for %s", language => {
		expect(buildEditorExtensions(language).length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// createTemplateEditor
// ---------------------------------------------------------------------------

describe("createTemplateEditor", () => {
	it.each([
		["html", "HTML template"], ["css", "CSS styles"], ["javascript", "JavaScript code"],
	] as const)("gives the %s editing surface an accessible name", (language, label) => {
		const view = createAndTrack({ initialContent: "", language });
		expect(view.contentDOM.getAttribute("role")).toBe("textbox");
		expect(view.contentDOM.getAttribute("aria-label")).toBe(label);
		view.dispatch({ changes: { from: 0, insert: "Updated" } });
		expect(view.contentDOM.getAttribute("aria-label")).toBe(label);
	});
	it("labels the default HTML editor", () => {
		const view = createAndTrack({ initialContent: "" });
		expect(view.contentDOM.getAttribute("aria-label")).toBe("HTML template");
	});

	it.each([
		["", 1],
		["<div>Hello {{title}}</div>", 1],
		['<div class="test" data-value="a&b">text</div>', 1],
		["<div>\n  <h1>{{title}}</h1>\n  <p>{{body}}</p>\n</div>", 4],
	])("loads initial content %j verbatim", (content, lines) => {
		const view = createAndTrack({ initialContent: content });
		expect(view.state.doc.toString()).toBe(content);
		expect(view.state.doc.lines).toBe(lines);
	});

	it("calls onChange when content changes", () => {
		const onChange = vi.fn();
		const view = createAndTrack({
			initialContent: "initial",
			onChange,
		});

		// Simulate a document change
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: "updated" },
		});

		expect(onChange).toHaveBeenCalledWith("updated");
	});

	it("does not call onChange when no document change occurs", () => {
		const onChange = vi.fn();
		createAndTrack({
			initialContent: "hello",
			onChange,
		});

		// onChange should not have been called just from creation
		expect(onChange).not.toHaveBeenCalled();
	});

	it("calls onChange multiple times for multiple changes", () => {
		const onChange = vi.fn();
		const view = createAndTrack({
			initialContent: "",
			onChange,
		});

		view.dispatch({ changes: { from: 0, insert: "first" } });
		view.dispatch({
			changes: { from: view.state.doc.length, insert: " second" },
		});

		expect(onChange).toHaveBeenCalledTimes(2);
		expect(onChange).toHaveBeenNthCalledWith(1, "first");
		expect(onChange).toHaveBeenNthCalledWith(2, "first second");
	});

	it("works without onChange callback", () => {
		const view = createAndTrack({ initialContent: "no callback" });

		// Should not throw when dispatching changes without onChange
		expect(() => {
			view.dispatch({
				changes: {
					from: 0,
					to: view.state.doc.length,
					insert: "changed",
				},
			});
		}).not.toThrow();

		expect(view.state.doc.toString()).toBe("changed");
	});

	it("has line numbers enabled (gutter present in DOM)", () => {
		const view = createAndTrack({ initialContent: "<p>hello</p>" });
		// CM6 renders gutters with the class 'cm-gutters'
		const gutters = view.dom.querySelector(".cm-gutters");
		expect(gutters).not.toBeNull();
	});

});

// ---------------------------------------------------------------------------
// setEditorContent
// ---------------------------------------------------------------------------

describe("setEditorContent", () => {
	it("replaces the whole document each time and notifies onChange", () => {
		const onChange = vi.fn();
		const view = createAndTrack({ initialContent: "old content", onChange });
		for (const next of ["new content", "", "<div>\n  <span>hello</span>\n</div>"]) {
			setEditorContent(view, next);
			expect(view.state.doc.toString()).toBe(next);
			expect(onChange).toHaveBeenLastCalledWith(next);
		}
		expect(view.state.doc.lines).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// autoCloseHTMLTags
// ---------------------------------------------------------------------------

describe("autoCloseHTMLTags", () => {
	it("auto-closes a div tag when > is typed", () => {
		const view = createAndTrack({ initialContent: "<div" });
		// Simulate typing ">" at the end
		const from = view.state.doc.length;
		expect(simulateInput(view, from, from, ">")).toBe(true);
		expect(view.state.doc.toString()).toBe("<div></div>");
		// Cursor should be between > and </
		expect(view.state.selection.main.head).toBe(5); // after ">"
	});

	it("auto-closes a span tag", () => {
		const view = createAndTrack({ initialContent: "<span" });
		const from = view.state.doc.length;
		expect(simulateInput(view, from, from, ">")).toBe(true);
		expect(view.state.doc.toString()).toBe("<span></span>");
	});

	it("auto-closes tags with attributes", () => {
		const view = createAndTrack({
			initialContent: '<a href="http://example.com"',
		});
		const from = view.state.doc.length;
		expect(simulateInput(view, from, from, ">")).toBe(true);
		expect(view.state.doc.toString()).toBe('<a href="http://example.com"></a>');
	});

	it("does NOT auto-close void elements (br, img, input, etc.)", () => {
		for (const tag of ["br", "img", "input", "hr", "meta", "link"]) {
			const view = createAndTrack({ initialContent: `<${tag}` });
			const from = view.state.doc.length;
			const handled = simulateInput(view, from, from, ">");
			if (!handled) {
				// Input handler returned false, meaning no auto-close
				// Manually insert ">" to verify no closing tag was added
				view.dispatch({ changes: { from, insert: ">" } });
				expect(view.state.doc.toString()).toBe(`<${tag}>`);
			} else {
				// Should not contain closing tag
				expect(view.state.doc.toString()).not.toContain(`</${tag}>`);
			}
			view.destroy();
		}
		// Clear tracked editors since we manually destroyed them
		editors.length = 0;
	});

	it("does NOT auto-close self-closing tags (ends with /)", () => {
		const view = createAndTrack({ initialContent: "<div /" });
		const from = view.state.doc.length;
		const handled = simulateInput(view, from, from, ">");
		// Should not auto-close because it ends with "/"
		if (!handled) {
			view.dispatch({ changes: { from, insert: ">" } });
		}
		expect(view.state.doc.toString()).not.toContain("</div>");
	});

	it("does NOT auto-close when > is typed outside a tag", () => {
		const view = createAndTrack({ initialContent: "hello " });
		const from = view.state.doc.length;
		const handled = simulateInput(view, from, from, ">");
		expect(handled).toBe(false);
	});

	it("handles custom/hyphenated tag names", () => {
		const view = createAndTrack({ initialContent: "<my-component" });
		const from = view.state.doc.length;
		expect(simulateInput(view, from, from, ">")).toBe(true);
		expect(view.state.doc.toString()).toBe("<my-component></my-component>");
	});
});

// ---------------------------------------------------------------------------
// Helper: simulate inputHandler
// ---------------------------------------------------------------------------

describe("syntax-aware suggestions", () => {
	async function suggestions(language: "html" | "css" | "javascript", content: string, pos = content.length) {
		const view = createAndTrack({ language, initialContent: content, templateVariables: [{ name: "rating", type: "number" }] });
		view.dispatch({ selection: { anchor: pos } });
		startCompletion(view);
		await vi.waitFor(() => expect(completionStatus(view.state)).not.toBe("pending"));
		return currentCompletions(view.state);
	}
	it.each([
		["html", "<di", "div", "type"],
		["html", "<input ty", "type", "property"],
		["html", '<input type="', "checkbox", "constant"],
		["css", ".card { dis", "display", "property"],
		["css", ".card { display: f", "flex", "keyword"],
		["javascript", "const movieTitle = 'Test';\nmov", "movieTitle", "variable"],
		["javascript", "document.que", "querySelector", "method"],
		["html", "<style>.card { display: f", "flex", "keyword"],
		["html", "<script>document.que", "querySelector", "method"],
	] as const)("offers %s %s with the correct completion type", async (language, content, label, type) => {
		expect(await suggestions(language, content)).toContainEqual(expect.objectContaining({ label, type }));
	});
	it.each(["html", "css", "javascript"] as const)("keeps typed template properties in %s", async language => {
		const options = await suggestions(language, "{{rat");
		expect(options).toContainEqual(expect.objectContaining({ label: "rating", type: "cv-number" }));
		expect(options.some(option => option.label.startsWith("<"))).toBe(false);
	});
	it.each([
		["html", "<!-- <di -->", 8], ["css", "/* dis"], ["javascript", "// doc"],
		["javascript", 'const text = "doc'],
	] as const)("does not suggest language names inside %s comments or strings", async (language, content, pos?: number) => {
		expect(await suggestions(language, content, pos)).toEqual([]);
	});
});

/**
 * Simulates the CM6 inputHandler by calling the handler function directly.
 * Returns true if the handler consumed the input.
 */
function simulateInput(
	view: EditorView,
	from: number,
	to: number,
	text: string
): boolean {
	// The EditorView.inputHandler facet handlers have signature:
	// (view, from, to, text, insert) => boolean
	view.dispatch({ selection: { anchor: from, head: to } });
	const facetValues = view.state.facet(EditorView.inputHandler);
	const defaultInsert = () => {
		return view.state.update({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
	};
	for (const handler of facetValues) {
		if (handler(view, from, to, text, defaultInsert)) {
			return true;
		}
	}
	return false;
}
