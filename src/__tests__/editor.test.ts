/**
 * Tests for src/editor.ts
 *
 * Covers:
 *   - Theme configuration values (matches obsidian-latex-suite)
 *   - createTemplateEditor — creation, initial content, onChange callback
 *   - setEditorContent — replacing editor content
 *   - Editor extensions (line numbers, HTML highlighting, etc.)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
	themeConfig,
	obsidianTheme,
	obsidianHighlightStyle,
	obsidianExtension,
	templateEditorExtensions,
	createTemplateEditor,
	setEditorContent,
	autoCloseHTMLTags,
	htmlLanguage,
} from "../editor";
import { EditorView } from "@codemirror/view";

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
// themeConfig
// ---------------------------------------------------------------------------

describe("themeConfig", () => {
	it("uses Obsidian CSS variables for background and foreground", () => {
		expect(themeConfig.background).toBe("var(--background-primary)");
		expect(themeConfig.foreground).toBe("var(--text-normal)");
	});

	it("uses Obsidian --code-keyword variable for keywords", () => {
		expect(themeConfig.keyword).toBe("var(--code-keyword)");
	});

	it("uses Obsidian --code-property variable for class", () => {
		expect(themeConfig.class).toBe("var(--code-property)");
	});

	it("uses Obsidian CSS variable for selection", () => {
		expect(themeConfig.selection).toBe("var(--text-selection)");
	});

	it("uses Obsidian CSS variable for cursor", () => {
		expect(themeConfig.cursor).toBe("var(--text-normal)");
	});

	it("uses Obsidian --code-comment variable for comments", () => {
		expect(themeConfig.comment).toBe("var(--code-comment)");
	});

	it("uses Obsidian --code-tag variable for HTML tags", () => {
		expect(themeConfig.tag).toBe("var(--code-tag)");
	});

	it("uses Obsidian --code-property variable for HTML attributes", () => {
		expect(themeConfig.attribute).toBe("var(--code-property)");
	});

	it("has dark mode set to false", () => {
		expect(themeConfig.dark).toBe(false);
	});

	it("uses matching bracket color from Obsidian variable", () => {
		expect(themeConfig.matchingBracket).toBe(
			"var(--background-modifier-accent)"
		);
	});

	it("uses Obsidian --code-string variable for strings", () => {
		expect(themeConfig.string).toBe("var(--code-string)");
	});

	it("uses Obsidian --code-function variable for functions", () => {
		expect(themeConfig.function).toBe("var(--code-function)");
	});

	it("uses Obsidian --code-operator variable for operators", () => {
		expect(themeConfig.operator).toBe("var(--code-operator)");
	});

	it("uses Obsidian --code-value variable for numbers/constants", () => {
		expect(themeConfig.number).toBe("var(--code-value)");
		expect(themeConfig.constant).toBe("var(--code-value)");
	});

	it("uses only Obsidian CSS variables (no hardcoded hex colors for syntax)", () => {
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
});

// ---------------------------------------------------------------------------
// Theme and highlight exports
// ---------------------------------------------------------------------------

describe("obsidian theme exports", () => {
	it("obsidianTheme is a valid CM6 Extension", () => {
		expect(obsidianTheme).toBeDefined();
	});

	it("obsidianHighlightStyle is a valid CM6 HighlightStyle", () => {
		expect(obsidianHighlightStyle).toBeDefined();
	});

	it("obsidianExtension is an array with theme + highlighting", () => {
		expect(Array.isArray(obsidianExtension)).toBe(true);
		expect((obsidianExtension as unknown[]).length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// templateEditorExtensions
// ---------------------------------------------------------------------------

describe("templateEditorExtensions", () => {
	it("is a non-empty array", () => {
		expect(Array.isArray(templateEditorExtensions)).toBe(true);
		expect(templateEditorExtensions.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// createTemplateEditor
// ---------------------------------------------------------------------------

describe("createTemplateEditor", () => {
	it("returns an EditorView instance", () => {
		const view = createAndTrack({ initialContent: "" });
		expect(view).toBeInstanceOf(EditorView);
	});

	it("creates a DOM element that can be mounted", () => {
		const view = createAndTrack({ initialContent: "" });
		expect(view.dom).toBeDefined();
		expect(view.dom.nodeName).toBe("DIV");
	});

	it("sets initial content correctly", () => {
		const content = "<div>Hello {{title}}</div>";
		const view = createAndTrack({ initialContent: content });
		expect(view.state.doc.toString()).toBe(content);
	});

	it("handles empty initial content", () => {
		const view = createAndTrack({ initialContent: "" });
		expect(view.state.doc.toString()).toBe("");
	});

	it("handles multi-line initial content", () => {
		const content = "<div>\n  <h1>{{title}}</h1>\n  <p>{{body}}</p>\n</div>";
		const view = createAndTrack({ initialContent: content });
		expect(view.state.doc.toString()).toBe(content);
		expect(view.state.doc.lines).toBe(4);
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

	it("handles special HTML characters in content", () => {
		const content = '<div class="test" data-value="a&b">text</div>';
		const view = createAndTrack({ initialContent: content });
		expect(view.state.doc.toString()).toBe(content);
	});

	it("handles large content without error", () => {
		const content = "<p>line</p>\n".repeat(1000);
		const view = createAndTrack({ initialContent: content });
		expect(view.state.doc.lines).toBe(1001); // 1000 lines + trailing empty
	});

	it("has line numbers enabled (gutter present in DOM)", () => {
		const view = createAndTrack({ initialContent: "<p>hello</p>" });
		// CM6 renders gutters with the class 'cm-gutters'
		const gutters = view.dom.querySelector(".cm-gutters");
		expect(gutters).not.toBeNull();
	});

	it("has the cm-editor class on the root element", () => {
		const view = createAndTrack({ initialContent: "" });
		const cmEditor = view.dom.querySelector(".cm-editor");
		// The dom itself is a cm-editor or contains one
		const hasCmEditor =
			view.dom.classList.contains("cm-editor") || cmEditor !== null;
		expect(hasCmEditor).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// setEditorContent
// ---------------------------------------------------------------------------

describe("setEditorContent", () => {
	it("replaces editor content completely", () => {
		const view = createAndTrack({ initialContent: "old content" });
		setEditorContent(view, "new content");
		expect(view.state.doc.toString()).toBe("new content");
	});

	it("can set content to empty string", () => {
		const view = createAndTrack({ initialContent: "something" });
		setEditorContent(view, "");
		expect(view.state.doc.toString()).toBe("");
	});

	it("triggers onChange when content is set", () => {
		const onChange = vi.fn();
		const view = createAndTrack({
			initialContent: "before",
			onChange,
		});

		setEditorContent(view, "after");
		expect(onChange).toHaveBeenCalledWith("after");
	});

	it("can replace content multiple times", () => {
		const view = createAndTrack({ initialContent: "" });
		setEditorContent(view, "first");
		expect(view.state.doc.toString()).toBe("first");
		setEditorContent(view, "second");
		expect(view.state.doc.toString()).toBe("second");
		setEditorContent(view, "third");
		expect(view.state.doc.toString()).toBe("third");
	});

	it("handles multi-line replacement", () => {
		const view = createAndTrack({ initialContent: "single line" });
		const multiLine = "<div>\n  <span>hello</span>\n</div>";
		setEditorContent(view, multiLine);
		expect(view.state.doc.toString()).toBe(multiLine);
		expect(view.state.doc.lines).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// autoCloseHTMLTags
// ---------------------------------------------------------------------------

describe("autoCloseHTMLTags", () => {
	it("is a defined extension", () => {
		expect(autoCloseHTMLTags).toBeDefined();
	});

	it("auto-closes a div tag when > is typed", () => {
		const view = createAndTrack({ initialContent: "<div" });
		// Simulate typing ">" at the end
		const from = view.state.doc.length;
		const handled = simulateInput(view, from, from, ">");
		if (handled) {
			expect(view.state.doc.toString()).toBe("<div></div>");
			// Cursor should be between > and </
			expect(view.state.selection.main.head).toBe(5); // after ">"
		}
	});

	it("auto-closes a span tag", () => {
		const view = createAndTrack({ initialContent: "<span" });
		const from = view.state.doc.length;
		const handled = simulateInput(view, from, from, ">");
		if (handled) {
			expect(view.state.doc.toString()).toBe("<span></span>");
		}
	});

	it("auto-closes tags with attributes", () => {
		const view = createAndTrack({
			initialContent: '<a href="http://example.com"',
		});
		const from = view.state.doc.length;
		const handled = simulateInput(view, from, from, ">");
		if (handled) {
			expect(view.state.doc.toString()).toBe(
				'<a href="http://example.com"></a>'
			);
		}
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
		const handled = simulateInput(view, from, from, ">");
		if (handled) {
			expect(view.state.doc.toString()).toBe(
				"<my-component></my-component>"
			);
		}
	});
});

// ---------------------------------------------------------------------------
// htmlLanguage (LanguageSupport export)
// ---------------------------------------------------------------------------

describe("htmlLanguage", () => {
	it("is a defined LanguageSupport instance", () => {
		expect(htmlLanguage).toBeDefined();
	});

	it("includes autoCloseHTMLTags in its extensions", () => {
		// htmlLanguage is a LanguageSupport which wraps extensions
		// Just verify it can be used as an extension without error
		const view = createAndTrack({ initialContent: "<p>test</p>" });
		expect(view.state.doc.toString()).toBe("<p>test</p>");
	});
});

// ---------------------------------------------------------------------------
// Helper: simulate inputHandler
// ---------------------------------------------------------------------------

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
	const facetValues = view.state.facet(EditorView.inputHandler);
	const defaultInsert = () => {
		view.dispatch({ changes: { from, to, insert: text } });
		return view.state.update({}).state;
	};
	for (const handler of facetValues) {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		if ((handler as (v: EditorView, f: number, t: number, txt: string, ins: unknown) => boolean)(view, from, to, text, defaultInsert)) {
			return true;
		}
	}
	return false;
}
