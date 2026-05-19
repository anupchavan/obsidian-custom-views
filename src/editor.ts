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
import { parser as cssParser } from "@lezer/css";
import { parser as jsParser } from "@lezer/javascript";

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
				})),
			};
		}
	}

	return null;
}

export const htmlLanguage = new LanguageSupport(htmlLang, [
	autoCloseHTMLTags,
]);

// ---------------------------------------------------------------------------
// CSS Language + Autocompletion
// ---------------------------------------------------------------------------

const cssLang = LRLanguage.define({
	name: "css",
	parser: cssParser.configure({
		props: [
			indentNodeProp.add({
				Block(context) {
					return context.baseIndent + context.unit;
				},
			}),
			foldNodeProp.add({
				Block: foldInside,
			}),
		],
	}),
	languageData: {
		commentTokens: { block: { open: "/*", close: "*/" } },
	},
});

const COMMON_CSS_PROPERTIES = [
	"align-items", "align-content", "align-self",
	"background", "background-color", "background-image", "background-position", "background-size",
	"border", "border-bottom", "border-color", "border-left", "border-radius", "border-right", "border-top", "border-width",
	"bottom", "box-shadow", "box-sizing",
	"color", "content", "cursor",
	"display",
	"flex", "flex-direction", "flex-grow", "flex-shrink", "flex-wrap", "float", "font", "font-family", "font-size", "font-weight",
	"gap", "grid", "grid-template-columns", "grid-template-rows",
	"height",
	"justify-content", "justify-items",
	"left", "letter-spacing", "line-height", "list-style",
	"margin", "margin-bottom", "margin-left", "margin-right", "margin-top", "max-height", "max-width", "min-height", "min-width",
	"opacity", "outline", "overflow", "overflow-x", "overflow-y",
	"padding", "padding-bottom", "padding-left", "padding-right", "padding-top", "position",
	"right",
	"text-align", "text-decoration", "text-overflow", "text-transform", "top", "transform", "transition",
	"visibility",
	"white-space", "width", "word-break", "word-wrap",
	"z-index",
];

function cssCompletionSource(context: CompletionContext): CompletionResult | null {
	// CSS property completion: triggered at start of line or after ; or { (inside a rule)
	const propMatch = context.matchBefore(/[\s;{][a-zA-Z-]*$/);
	if (propMatch) {
		return {
			from: propMatch.from + 1,
			options: COMMON_CSS_PROPERTIES.map(prop => ({
				label: prop,
			})),
		};
	}

	// Also match at the very start of input
	const startMatch = context.matchBefore(/^[a-zA-Z-]*$/);
	if (startMatch && context.pos === startMatch.to) {
		return {
			from: startMatch.from,
			options: COMMON_CSS_PROPERTIES.map(prop => ({
				label: prop,
			})),
		};
	}

	return null;
}

export const cssLanguage = new LanguageSupport(cssLang);

// ---------------------------------------------------------------------------
// JavaScript Language + Autocompletion
// ---------------------------------------------------------------------------

const jsLang = LRLanguage.define({
	name: "javascript",
	parser: jsParser.configure({
		props: [
			indentNodeProp.add({
				Block(context) {
					return context.baseIndent + context.unit;
				},
			}),
			foldNodeProp.add({
				Block: foldInside,
			}),
		],
	}),
	languageData: {
		commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
	},
});

const JS_KEYWORDS = [
	"async", "await", "break", "case", "catch", "class", "const", "continue",
	"debugger", "default", "delete", "do", "else", "export", "extends",
	"false", "finally", "for", "function", "if", "import", "in", "instanceof",
	"let", "new", "null", "of", "return", "static", "super", "switch",
	"this", "throw", "true", "try", "typeof", "undefined", "var", "void",
	"while", "yield",
];

const JS_GLOBALS = [
	"console", "document", "window", "Array", "Object", "String", "Number",
	"Math", "JSON", "Date", "Promise", "Map", "Set", "RegExp",
	"setTimeout", "setInterval", "clearTimeout", "clearInterval",
	"parseInt", "parseFloat", "encodeURIComponent", "decodeURIComponent",
	"querySelector", "querySelectorAll", "getElementById",
	"addEventListener", "removeEventListener",
	"fetch", "alert", "confirm",
];

function jsCompletionSource(context: CompletionContext): CompletionResult | null {
	const word = context.matchBefore(/[a-zA-Z_$][a-zA-Z0-9_$]*$/);
	if (!word) return null;
	// Don't trigger for very short prefixes unless explicitly requested
	if (word.to - word.from < 2 && !context.explicit) return null;

	return {
		from: word.from,
		options: [
			...JS_KEYWORDS.map(kw => ({ label: kw })),
			...JS_GLOBALS.map(g => ({ label: g })),
		],
	};
}

export const jsLanguage = new LanguageSupport(jsLang);

// ---------------------------------------------------------------------------
// Template Syntax: auto-close {{ and autocompletion
// ---------------------------------------------------------------------------

/** Available filter names for template {{...|filter}} completions */
const TEMPLATE_FILTERS = [
	{ label: "date", detail: 'format dates — date:"YYYY-MM-DD"' },
	{ label: "date_modify", detail: 'shift dates — date_modify:"+1 day"' },
	{ label: "capitalize", detail: "capitalize first letter" },
	{ label: "upper", detail: "UPPERCASE" },
	{ label: "lower", detail: "lowercase" },
	{ label: "title", detail: "Title Case" },
	{ label: "camel", detail: "camelCase" },
	{ label: "kebab", detail: "kebab-case" },
	{ label: "snake", detail: "snake_case" },
	{ label: "trim", detail: "strip whitespace" },
	{ label: "replace", detail: 'replace:"old","new"' },
	{ label: "wikilink", detail: "wrap as [[wikilink]]" },
	{ label: "link", detail: 'markdown link — link:"text"' },
	{ label: "image", detail: 'markdown image — image:"alt"' },
	{ label: "blockquote", detail: "> blockquote lines" },
	{ label: "strip_tags", detail: "remove HTML tags" },
	{ label: "split", detail: 'split to array — split:","' },
	{ label: "join", detail: 'join array — join:", "' },
	{ label: "first", detail: "first array element" },
	{ label: "last", detail: "last array element" },
	{ label: "slice", detail: "slice:start,end" },
	{ label: "count", detail: "length of string/array" },
	{ label: "calc", detail: 'arithmetic — calc:"+10"' },
];

/** Built-in file.* template variables */
const FILE_VARIABLES = [
	{ label: "file.basename", detail: "file name without extension" },
	{ label: "file.name", detail: "file name with extension" },
	{ label: "file.content", detail: "full markdown body" },
	{ label: "file.size", detail: "file size in bytes" },
	{ label: "file.ctime", detail: "creation timestamp" },
	{ label: "file.mtime", detail: "modified timestamp" },
];

/**
 * Auto-close {{ — typing the second { inserts }} and positions cursor
 * between the braces.
 *
 * Handles interaction with closeBrackets which may have already inserted
 * a `}` after the first `{`, so the document may be `{|}` when the second
 * `{` is typed.
 */
export const autoCloseTemplateBraces = EditorView.inputHandler.of(
	(view, from, to, text) => {
		if (text !== "{") return false;

		const { state } = view;
		// Check if the character before the cursor is already "{"
		if (from === 0) return false;
		const charBefore = state.sliceDoc(from - 1, from);
		if (charBefore !== "{") return false;

		// Don't auto-close if }} already follows the cursor
		const charAfter = state.sliceDoc(to, to + 2);
		if (charAfter === "}}") return false;

		if (charAfter.startsWith("}")) {
			// closeBrackets already added one `}` → doc is `{|}`
			// Insert `{` at cursor and `}` after the existing `}` → `{{|}}`
			view.dispatch({
				changes: [
					{ from, to, insert: "{" },
					{ from: to + 1, to: to + 1, insert: "}" },
				],
				selection: { anchor: from + 1 },
				annotations: Transaction.userEvent.of("input.autoclose"),
			});
		} else {
			// No closing braces at all — insert both
			view.dispatch({
				changes: { from, to, insert: "{}}"},
				selection: { anchor: from + 1 },
				annotations: Transaction.userEvent.of("input.autoclose"),
			});
		}
		return true;
	}
);

/**
 * Creates a template variable/filter completion source.
 * @param extraVariables — frontmatter property names from the vault
 */
export function templateCompletionSource(extraVariables: string[] = []) {
	return (context: CompletionContext): CompletionResult | null => {
		const { state, pos } = context;

		// Look back for {{ to know if we're inside a template expression
		const lineStart = state.doc.lineAt(pos).from;
		const textBefore = state.sliceDoc(lineStart, pos);

		// Find the last unmatched {{ before cursor
		const lastOpen = textBefore.lastIndexOf("{{");
		if (lastOpen === -1) return null;

		// Make sure it's not already closed before cursor
		const afterOpen = textBefore.substring(lastOpen + 2);
		if (afterOpen.includes("}}")) return null;

		// We're inside {{ ... — check if we're after a pipe (filter context)
		const pipeIndex = afterOpen.lastIndexOf("|");
		if (pipeIndex !== -1) {
			// Filter completion: after the last | inside {{...}}
			const afterPipe = afterOpen.substring(pipeIndex + 1).trimStart();
			const filterWord = afterPipe.match(/^([a-zA-Z_]*)$/);
			if (filterWord) {
				const from = pos - filterWord[1].length;
				return {
					from,
					options: TEMPLATE_FILTERS.map(f => ({
						label: f.label,
						detail: f.detail,
					})),
				};
			}
			return null;
		}

		// Variable completion: after {{ (possibly with partial text)
		const varText = afterOpen.trimStart();
		const varWord = varText.match(/^([a-zA-Z0-9_.]*)$/);
		if (varWord) {
			const from = pos - varWord[1].length;
			const options = [
				...FILE_VARIABLES.map(v => ({
					label: v.label,
					detail: v.detail,
				})),
				...extraVariables.map(v => ({
					label: v,
					detail: "frontmatter property",
				})),
			];
			return { from, options };
		}

		return null;
	};
}

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
		// Hide completion type icons
		".cm-completionIcon": {
			display: "none",
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

export type EditorLanguage = "html" | "css" | "javascript";

function getLanguageExtension(lang: EditorLanguage): LanguageSupport {
	switch (lang) {
		case "css": return cssLanguage;
		case "javascript": return jsLanguage;
		case "html":
		default: return htmlLanguage;
	}
}

type CompletionSourceFn = (context: CompletionContext) => CompletionResult | null;

function getLanguageCompletionSource(lang: EditorLanguage): CompletionSourceFn {
	switch (lang) {
		case "css": return cssCompletionSource;
		case "javascript": return jsCompletionSource;
		case "html":
		default: return htmlCompletionSource;
	}
}

export function buildEditorExtensions(lang: EditorLanguage = "html", extraTemplateVars: string[] = []): Extension[] {
	return [
		lineNumbers(),
		highlightSpecialChars(),
		history(),
		getLanguageExtension(lang),
		autoCloseTemplateBraces,
		autocompletion({
			override: [
				templateCompletionSource(extraTemplateVars),
				getLanguageCompletionSource(lang),
			],
			defaultKeymap: true,
		}),
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
}

/** @deprecated Use buildEditorExtensions() instead */
export const templateEditorExtensions: Extension[] = buildEditorExtensions("html");

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TemplateEditorOptions {
	/** Initial content of the editor */
	initialContent: string;
	/** Called on every document change with the new content */
	onChange?: (content: string) => void;
	/** Language mode for syntax highlighting (default: "html") */
	language?: EditorLanguage;
	/** Extra template variable names (e.g. frontmatter properties) for autocomplete */
	templateVariables?: string[];
}

/**
 * Creates a CodeMirror 6 editor configured for template editing.
 * Returns the EditorView instance — attach `editor.dom` to your container.
 */
export function createTemplateEditor(
	options: TemplateEditorOptions
): EditorView {
	const extensions: Extension[] = [...buildEditorExtensions(options.language ?? "html", options.templateVariables ?? [])];

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
