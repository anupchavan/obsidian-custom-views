/**
 * CodeMirror 6 editor for template editing.
 *
 * Provides a rich code editor with:
 *   - Line numbers
 *   - HTML syntax highlighting (without bundling JS/CSS parsers)
 *   - Auto-close HTML tags (typing ">" inserts "</tag>")
 *   - HTML tag/attribute autocompletion
 *   - Obsidian-themed colors via CSS variables
 *   - Bracket matching, auto-close brackets, indentation
 */

import {
	keymap,
	highlightSpecialChars,
	drawSelection,
	dropCursor,
	EditorView,
	lineNumbers,
	rectangularSelection,
	ViewUpdate,
} from "@codemirror/view";
import type { KeyBinding } from "@codemirror/view";
import { Extension, EditorState, Transaction } from "@codemirror/state";
import {
	LRLanguage,
	LanguageSupport,
	indentOnInput,
	indentUnit,
	bracketMatching,
	syntaxHighlighting,
	defaultHighlightStyle,
	HighlightStyle,
	indentNodeProp,
	foldNodeProp,
	foldInside,
} from "@codemirror/language";
import {
	defaultKeymap,
	indentWithTab,
	history,
	historyKeymap,
} from "@codemirror/commands";
import {
	closeBrackets,
	closeBracketsKeymap,
	autocompletion,
	CompletionContext,
	CompletionResult,
} from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import { tags as t } from "@lezer/highlight";
import { parser as htmlParser } from "@lezer/html";

// ---------------------------------------------------------------------------
// HTML Language (without JS/CSS sub-parsers — keeps bundle ~14KB vs ~120KB)
// ---------------------------------------------------------------------------

const htmlLang = LRLanguage.define({
	name: "html",
	parser: htmlParser.configure({
		props: [
			indentNodeProp.add({
				Element(context) {
					const after = /^(\s*)(<\/)?/.exec(context.textAfter);
					if (after && after[2]) return context.baseIndent;
					return context.baseIndent + context.unit;
				},
			}),
			foldNodeProp.add({
				Element: foldInside,
			}),
		],
	}),
	languageData: {
		commentTokens: { block: { open: "<!--", close: "-->" } },
		indentOnInput: /^\s*<\/\w+\W$/,
	},
});

// ---------------------------------------------------------------------------
// Auto-close HTML tags: typing ">" after <tagName inserts </tagName>
// ---------------------------------------------------------------------------

/** Tags that should not be auto-closed (void/self-closing elements). */
const VOID_ELEMENTS = new Set([
	"area", "base", "br", "col", "embed", "hr", "img", "input",
	"link", "meta", "param", "source", "track", "wbr",
]);

export const autoCloseHTMLTags = EditorView.inputHandler.of(
	(view, from, to, text) => {
		if (text !== ">") return false;

		const { state } = view;
		const before = state.sliceDoc(Math.max(0, from - 128), from);

		// Match an opening tag name: <tagName or <tagName attr="val"
		const match = before.match(/<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?\s*$/);
		if (!match) return false;

		const tagName = match[1].toLowerCase();
		if (VOID_ELEMENTS.has(tagName)) return false;

		// Check it's not a self-closing tag like <br/
		if (before.trimEnd().endsWith("/")) return false;

		const closing = `></${match[1]}>`;
		view.dispatch({
			changes: { from, to, insert: closing },
			selection: { anchor: from + 1 }, // cursor between > and </
			annotations: Transaction.userEvent.of("input.autoclosetag"),
		});
		return true;
	}
);

// ---------------------------------------------------------------------------
// HTML Autocompletion: common tags and attributes
// ---------------------------------------------------------------------------

const COMMON_TAGS = [
	"a", "abbr", "article", "aside", "b", "blockquote", "body", "br",
	"button", "canvas", "code", "details", "div", "dl", "dt", "dd", "em",
	"fieldset", "figure", "figcaption", "footer", "form", "h1", "h2",
	"h3", "h4", "h5", "h6", "head", "header", "hr", "html", "i", "iframe",
	"img", "input", "label", "legend", "li", "link", "main", "meta",
	"nav", "ol", "option", "p", "pre", "script", "section", "select",
	"small", "span", "strong", "style", "sub", "summary", "sup", "table",
	"tbody", "td", "textarea", "tfoot", "th", "thead", "time", "title",
	"tr", "ul", "video",
];

const COMMON_ATTRS = [
	"class", "id", "style", "href", "src", "alt", "title", "type",
	"name", "value", "placeholder", "disabled", "hidden", "target",
	"rel", "width", "height", "data-", "aria-",
];

function htmlCompletionSource(context: CompletionContext): CompletionResult | null {
	// Tag name completion: triggered after "<"
	const tagMatch = context.matchBefore(/<[a-zA-Z0-9-]*$/);
	if (tagMatch) {
		return {
			from: tagMatch.from + 1, // after the "<"
			options: COMMON_TAGS.map(tag => ({
				label: tag,
				type: "type",
			})),
		};
	}

	// Attribute completion: triggered inside a tag after space
	const attrMatch = context.matchBefore(/\s[a-zA-Z-]*$/);
	if (attrMatch) {
		// Verify we're inside a tag (look back for unclosed "<")
		const line = context.state.sliceDoc(
			Math.max(0, attrMatch.from - 256),
			attrMatch.from
		);
		const lastOpen = line.lastIndexOf("<");
		const lastClose = line.lastIndexOf(">");
		if (lastOpen > lastClose) {
			return {
				from: attrMatch.from + 1, // after the space
				options: COMMON_ATTRS.map(attr => ({
					label: attr,
					type: "property",
				})),
			};
		}
	}

	return null;
}

export const htmlLanguage = new LanguageSupport(htmlLang, [
	autoCloseHTMLTags,
	autocompletion({
		override: [htmlCompletionSource],
		defaultKeymap: true,
	}),
]);

// ---------------------------------------------------------------------------
// Theme configuration — uses Obsidian CSS variables for all colors
// ---------------------------------------------------------------------------

export const themeConfig = {
	name: "obsidian",
	dark: false,
	background: "var(--background-primary)",
	foreground: "var(--text-normal)",
	selection: "var(--text-selection)",
	cursor: "var(--text-normal)",
	dropdownBackground: "var(--background-primary)",
	dropdownBorder: "var(--background-modifier-border)",
	activeLine: "var(--background-primary)",
	matchingBracket: "var(--background-modifier-accent)",
	// All syntax colors use Obsidian's built-in CSS variables so they
	// adapt correctly to any theme (light, dark, or custom).
	keyword: "var(--code-keyword)",
	storage: "var(--code-keyword)",
	variable: "var(--code-normal)",
	parameter: "var(--code-property)",
	function: "var(--code-function)",
	string: "var(--code-string)",
	constant: "var(--code-value)",
	type: "var(--code-property)",
	class: "var(--code-property)",
	number: "var(--code-value)",
	comment: "var(--code-comment)",
	heading: "var(--code-keyword)",
	invalid: "var(--text-error)",
	regexp: "var(--code-string)",
	tag: "var(--code-tag)",
	attribute: "var(--code-property)",
	operator: "var(--code-operator)",
	punctuation: "var(--code-punctuation)",
	important: "var(--code-important)",
};

export const obsidianTheme = EditorView.theme(
	{
		"&": {
			color: themeConfig.foreground,
			backgroundColor: themeConfig.background,
		},

		".cm-content": { caretColor: themeConfig.cursor },

		"&.cm-focused .cm-cursor": { borderLeftColor: themeConfig.cursor },
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, & ::selection":
			{ backgroundColor: themeConfig.selection },

		".cm-panels": {
			backgroundColor: themeConfig.dropdownBackground,
			color: themeConfig.foreground,
		},
		".cm-panels.cm-panels-top": { borderBottom: "2px solid black" },
		".cm-panels.cm-panels-bottom": { borderTop: "2px solid black" },

		".cm-searchMatch": {
			backgroundColor: themeConfig.dropdownBackground,
			outline: `1px solid ${themeConfig.dropdownBorder}`,
		},
		".cm-searchMatch.cm-searchMatch-selected": {
			backgroundColor: themeConfig.selection,
		},

		".cm-activeLine": { backgroundColor: themeConfig.activeLine },
		".cm-activeLineGutter": { backgroundColor: themeConfig.background },
		".cm-selectionMatch": { backgroundColor: themeConfig.selection },

		".cm-matchingBracket, .cm-nonmatchingBracket": {
			backgroundColor: themeConfig.matchingBracket,
			outline: "none",
		},
		".cm-gutters": {
			backgroundColor: themeConfig.background,
			color: themeConfig.comment,
			borderRight: "1px solid var(--background-modifier-border)",
		},
		".cm-lineNumbers, .cm-gutterElement": { color: "inherit" },

		".cm-foldPlaceholder": {
			backgroundColor: "transparent",
			border: "none",
			color: themeConfig.foreground,
		},

		".cm-tooltip": {
			border: `1px solid ${themeConfig.dropdownBorder}`,
			backgroundColor: themeConfig.dropdownBackground,
			color: themeConfig.foreground,
		},
		".cm-tooltip.cm-tooltip-autocomplete": {
			"& > ul > li[aria-selected]": {
				background: themeConfig.selection,
				color: themeConfig.foreground,
			},
		},
	},
	{ dark: themeConfig.dark }
);

export const obsidianHighlightStyle = HighlightStyle.define([
	{ tag: t.keyword, color: themeConfig.keyword },
	{
		tag: [t.name, t.deleted, t.character, t.macroName],
		color: themeConfig.variable,
	},
	{ tag: [t.propertyName], color: themeConfig.function },
	{
		tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)],
		color: themeConfig.string,
	},
	{
		tag: [t.function(t.variableName), t.labelName],
		color: themeConfig.function,
	},
	{
		tag: [t.color, t.constant(t.name), t.standard(t.name)],
		color: themeConfig.constant,
	},
	{
		tag: [t.definition(t.name), t.separator],
		color: themeConfig.variable,
	},
	{ tag: [t.className], color: themeConfig.class },
	{
		tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
		color: themeConfig.number,
	},
	{ tag: [t.typeName], color: themeConfig.type },
	{ tag: [t.operator, t.operatorKeyword], color: themeConfig.operator },
	{ tag: [t.url, t.escape, t.regexp, t.link], color: themeConfig.regexp },
	{ tag: [t.meta, t.comment], color: themeConfig.comment },
	{ tag: t.strong, fontWeight: "bold" },
	{ tag: t.emphasis, fontStyle: "italic" },
	{ tag: t.link, textDecoration: "underline" },
	{ tag: t.heading, fontWeight: "bold", color: themeConfig.heading },
	{
		tag: [t.atom, t.bool, t.special(t.variableName)],
		color: themeConfig.constant,
	},
	{ tag: t.invalid, color: themeConfig.invalid },
	{ tag: t.strikethrough, textDecoration: "line-through" },
	{ tag: t.punctuation, color: themeConfig.punctuation },
	// HTML-specific tags
	{ tag: t.tagName, color: themeConfig.tag },
	{ tag: t.attributeName, color: themeConfig.attribute },
	{ tag: t.attributeValue, color: themeConfig.string },
]);

export const obsidianExtension: Extension = [
	obsidianTheme,
	syntaxHighlighting(obsidianHighlightStyle),
];

// ---------------------------------------------------------------------------
// Extensions bundle
// ---------------------------------------------------------------------------

export const templateEditorExtensions: Extension[] = [
	lineNumbers(),
	highlightSpecialChars(),
	history(),
	htmlLanguage,
	drawSelection(),
	dropCursor(),
	EditorState.allowMultipleSelections.of(true),
	indentOnInput(),
	indentUnit.of("    "),
	syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
	EditorView.lineWrapping,
	bracketMatching(),
	closeBrackets(),
	rectangularSelection(),
	highlightSelectionMatches(),
	obsidianExtension,
	keymap.of([
		...closeBracketsKeymap,
		...defaultKeymap,
		...searchKeymap,
		...historyKeymap,
		indentWithTab,
		...(lintKeymap as KeyBinding[]),
	]),
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TemplateEditorOptions {
	/** Initial content of the editor */
	initialContent: string;
	/** Called on every document change with the new content */
	onChange?: (content: string) => void;
}

/**
 * Creates a CodeMirror 6 editor configured for HTML template editing.
 * Returns the EditorView instance — attach `editor.dom` to your container.
 */
export function createTemplateEditor(
	options: TemplateEditorOptions
): EditorView {
	const extensions: Extension[] = [...templateEditorExtensions];

	if (options.onChange) {
		const changeListener = EditorView.updateListener.of(
			(update: ViewUpdate) => {
				if (update.docChanged) {
					options.onChange!(update.state.doc.toString());
				}
			}
		);
		extensions.push(changeListener);
	}

	const view = new EditorView({
		state: EditorState.create({
			doc: options.initialContent,
			extensions,
		}),
	});

	return view;
}

/**
 * Replaces the content of an existing editor view.
 */
export function setEditorContent(view: EditorView, content: string): void {
	view.dispatch({
		changes: {
			from: 0,
			to: view.state.doc.length,
			insert: content,
		},
	});
}
