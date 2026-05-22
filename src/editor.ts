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
	{ label: "pascal", detail: "PascalCase" },
	{ label: "trim", detail: "strip whitespace" },
	{ label: "replace", detail: 'replace:"old","new"' },
	{ label: "wikilink", detail: "wrap as [[wikilink]]" },
	{ label: "link", detail: 'markdown link — link:"text"' },
	{ label: "image", detail: 'markdown image — image:"alt"' },
	{ label: "blockquote", detail: "> blockquote lines" },
	{ label: "strip_tags", detail: "remove HTML tags" },
	{ label: "strip_md", detail: "strip markdown syntax" },
	{ label: "markdown", detail: "HTML to markdown" },
	{ label: "split", detail: 'split to array — split:","' },
	{ label: "join", detail: 'join array — join:", "' },
	{ label: "first", detail: "first array element" },
	{ label: "last", detail: "last array element" },
	{ label: "slice", detail: "slice:start,end" },
	{ label: "count", detail: "length of string/array" },
	{ label: "calc", detail: 'arithmetic — calc:"+10"' },
	{ label: "unique", detail: "remove duplicates" },
	{ label: "reverse", detail: "reverse string/array" },
	{ label: "round", detail: "round number" },
	{ label: "number_format", detail: "format with commas" },
	{ label: "safe_name", detail: "safe filename" },
	{ label: "remove_html", detail: "strip all HTML" },
	{ label: "unescape", detail: "unescape HTML entities" },
	{ label: "template", detail: 'template:"Hello {{value}}"' },
	{ label: "callout", detail: 'callout:"type","title"' },
	{ label: "footnote", detail: 'footnote:"id"' },
	{ label: "table", detail: "array to markdown table" },
];

/** Built-in file.* template variables (legacy mode) */
const FILE_VARIABLES = [
	{ label: "file.basename", detail: "file name without extension" },
	{ label: "file.name", detail: "file name with extension" },
	{ label: "file.content", detail: "full markdown body" },
	{ label: "file.size", detail: "file size in bytes" },
	{ label: "file.ctime", detail: "creation timestamp" },
	{ label: "file.mtime", detail: "modified timestamp" },
];

// ---------------------------------------------------------------------------
// Expression-mode suggestion catalogs
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Template variable with type info for autocomplete icons
// ---------------------------------------------------------------------------

/** A frontmatter/file property with its type, used for typed autocomplete icons */
export interface TemplateVariable {
	/** Property name */
	name: string;
	/** Property type (matches Obsidian's property type system) */
	type: "text" | "number" | "date" | "datetime" | "list" | "checkbox" | "file" | "unknown";
}

// ---------------------------------------------------------------------------
// Lucide SVG data URIs for completion icons
// ---------------------------------------------------------------------------

/** square-function — for functions and methods */
const ICON_FUNCTION = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2'/%3E%3Cpath d='M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3'/%3E%3Cpath d='M9 11.2h5.7'/%3E%3C/svg%3E";

/** text (align-left) — for text properties */
const ICON_TEXT = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M17 6H3'/%3E%3Cpath d='M21 12H3'/%3E%3Cpath d='M15 18H3'/%3E%3C/svg%3E";

/** binary — for number properties */
const ICON_NUMBER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='14' y='14' width='4' height='6' rx='2'/%3E%3Crect x='6' y='4' width='4' height='6' rx='2'/%3E%3Cpath d='M6 20h4'/%3E%3Cpath d='M14 10h4'/%3E%3Cpath d='M6 14h2v6'/%3E%3Cpath d='M14 4h2v6'/%3E%3C/svg%3E";

/** calendar — for date properties */
const ICON_DATE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 2v4'/%3E%3Cpath d='M16 2v4'/%3E%3Crect width='18' height='18' x='3' y='4' rx='2'/%3E%3Cpath d='M3 10h18'/%3E%3C/svg%3E";

/** clock — for datetime properties */
const ICON_CLOCK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpolyline points='12 6 12 12 16 14'/%3E%3C/svg%3E";

/** list — for list/array properties */
const ICON_LIST = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cline x1='8' x2='21' y1='6' y2='6'/%3E%3Cline x1='8' x2='21' y1='12' y2='12'/%3E%3Cline x1='8' x2='21' y1='18' y2='18'/%3E%3Cline x1='3' x2='3.01' y1='6' y2='6'/%3E%3Cline x1='3' x2='3.01' y1='12' y2='12'/%3E%3Cline x1='3' x2='3.01' y1='18' y2='18'/%3E%3C/svg%3E";

/** check-square — for checkbox properties */
const ICON_CHECKBOX = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2'/%3E%3Cpath d='m9 12 2 2 4-4'/%3E%3C/svg%3E";

/** file — for file properties */
const ICON_FILE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'/%3E%3Cpath d='M14 2v4a2 2 0 0 0 2 2h4'/%3E%3C/svg%3E";

/**
 * Maps TemplateVariable type to a CM completion type string.
 * Each maps to a CSS class like `.cm-completionIcon-cv-number`.
 */
function propertyCompletionType(propType: string): string {
	switch (propType) {
		case "number": return "cv-number";
		case "date": return "cv-date";
		case "datetime": return "cv-datetime";
		case "list": return "cv-list";
		case "checkbox": return "cv-checkbox";
		case "file": return "cv-file";
		case "text":
		default: return "cv-text";
	}
}

/** Global functions available in expression mode */
const EXPR_FUNCTIONS: { label: string; detail: string; apply: string }[] = [
	{ label: "link()", detail: "create wiki-link", apply: "link(" },
	{ label: "file()", detail: "resolve file by name", apply: "file(" },
	{ label: "if()", detail: "conditional expression", apply: "if(" },
	{ label: "for()", detail: "iterate over list", apply: "for(" },
	{ label: "now()", detail: "current date/time", apply: "now()" },
	{ label: "today()", detail: "today at midnight", apply: "today()" },
	{ label: "date()", detail: "parse a date string", apply: "date(" },
	{ label: "duration()", detail: "parse duration value", apply: "duration(" },
	{ label: "min()", detail: "minimum of values", apply: "min(" },
	{ label: "max()", detail: "maximum of values", apply: "max(" },
	{ label: "list()", detail: "create a list", apply: "list(" },
	{ label: "number()", detail: "convert to number", apply: "number(" },
	{ label: "image()", detail: "markdown image tag", apply: "image(" },
	{ label: "icon()", detail: "icon span element", apply: "icon(" },
	{ label: "html()", detail: "raw HTML output", apply: "html(" },
	{ label: "escapeHTML()", detail: "escape HTML entities", apply: "escapeHTML(" },
	{ label: "length()", detail: "string/list length", apply: "length(" },
	{ label: "typeof()", detail: "type of value", apply: "typeof(" },
	{ label: "concat()", detail: "concatenate strings", apply: "concat(" },
	{ label: "random()", detail: "random number", apply: "random(" },
];

/** ExprFile property suggestions */
const FILE_PROPS: { label: string; detail: string }[] = [
	{ label: "name", detail: "file name with extension" },
	{ label: "basename", detail: "file name without extension" },
	{ label: "path", detail: "full file path" },
	{ label: "folder", detail: "parent folder" },
	{ label: "ext", detail: "file extension" },
	{ label: "size", detail: "file size in bytes" },
	{ label: "ctime", detail: "creation time" },
	{ label: "mtime", detail: "modified time" },
	{ label: "tags", detail: "file tags array" },
	{ label: "links", detail: "outgoing links array" },
	{ label: "properties", detail: "frontmatter object" },
];

/** Type mapping for built-in file properties */
const FILE_PROP_TYPES: Record<string, string> = {
	name: "text",
	basename: "text",
	path: "text",
	folder: "text",
	ext: "text",
	size: "number",
	ctime: "datetime",
	mtime: "datetime",
	tags: "list",
	links: "list",
	properties: "text",
};

/** ExprFile method suggestions */
const FILE_METHODS: { label: string; detail: string; apply: string }[] = [
	{ label: "content()", detail: "read file content", apply: "content()" },
	{ label: "asLink()", detail: "convert to wiki-link", apply: "asLink()" },
	{ label: "hasLink()", detail: "check outgoing link", apply: "hasLink(" },
	{ label: "hasProperty()", detail: "check frontmatter key", apply: "hasProperty(" },
	{ label: "hasTag()", detail: "check for tag", apply: "hasTag(" },
	{ label: "inFolder()", detail: "check folder path", apply: "inFolder(" },
	{ label: "toString()", detail: "convert to string", apply: "toString()" },
	{ label: "isTruthy()", detail: "check truthiness", apply: "isTruthy()" },
	{ label: "isType()", detail: "check type", apply: "isType(" },
];

/** ExprLink method suggestions */
const LINK_METHODS: { label: string; detail: string; apply: string }[] = [
	{ label: "asFile()", detail: "resolve to file object", apply: "asFile()" },
	{ label: "linksTo()", detail: "check if links to target", apply: "linksTo(" },
	{ label: "toString()", detail: "convert to string", apply: "toString()" },
	{ label: "isTruthy()", detail: "check truthiness", apply: "isTruthy()" },
	{ label: "isType()", detail: "check type", apply: "isType(" },
];

/** String method suggestions */
const STRING_METHODS: { label: string; detail: string; apply: string }[] = [
	{ label: "contains()", detail: "check substring", apply: "contains(" },
	{ label: "startsWith()", detail: "check prefix", apply: "startsWith(" },
	{ label: "endsWith()", detail: "check suffix", apply: "endsWith(" },
	{ label: "isEmpty()", detail: "check if empty", apply: "isEmpty()" },
	{ label: "lower()", detail: "to lowercase", apply: "lower()" },
	{ label: "upper()", detail: "to UPPERCASE", apply: "upper()" },
	{ label: "title()", detail: "to Title Case", apply: "title()" },
	{ label: "capitalize()", detail: "capitalize first", apply: "capitalize()" },
	{ label: "trim()", detail: "strip whitespace", apply: "trim()" },
	{ label: "replace()", detail: "find and replace", apply: "replace(" },
	{ label: "repeat()", detail: "repeat N times", apply: "repeat(" },
	{ label: "reverse()", detail: "reverse string", apply: "reverse()" },
	{ label: "slice()", detail: "substring by index", apply: "slice(" },
	{ label: "split()", detail: "split to array", apply: "split(" },
	{ label: "length()", detail: "character count", apply: "length()" },
	{ label: "toString()", detail: "convert to string", apply: "toString()" },
	{ label: "isTruthy()", detail: "check truthiness", apply: "isTruthy()" },
];

/** Number method suggestions */
const NUMBER_METHODS: { label: string; detail: string; apply: string }[] = [
	{ label: "abs()", detail: "absolute value", apply: "abs()" },
	{ label: "ceil()", detail: "round up", apply: "ceil()" },
	{ label: "floor()", detail: "round down", apply: "floor()" },
	{ label: "round()", detail: "round to decimals", apply: "round(" },
	{ label: "toFixed()", detail: "fixed decimals string", apply: "toFixed(" },
	{ label: "isEmpty()", detail: "check if null", apply: "isEmpty()" },
	{ label: "toString()", detail: "convert to string", apply: "toString()" },
];

/** List/array method suggestions */
const LIST_METHODS: { label: string; detail: string; apply: string }[] = [
	{ label: "contains()", detail: "check for item", apply: "contains(" },
	{ label: "filter()", detail: "filter items", apply: "filter(" },
	{ label: "flat()", detail: "flatten one level", apply: "flat()" },
	{ label: "isEmpty()", detail: "check if empty", apply: "isEmpty()" },
	{ label: "join()", detail: "join to string", apply: "join(" },
	{ label: "map()", detail: "extract property", apply: "map(" },
	{ label: "reduce()", detail: "reduce to sum", apply: "reduce()" },
	{ label: "reverse()", detail: "reverse order", apply: "reverse()" },
	{ label: "slice()", detail: "subset by index", apply: "slice(" },
	{ label: "sort()", detail: "sort items", apply: "sort(" },
	{ label: "unique()", detail: "remove duplicates", apply: "unique()" },
	{ label: "first()", detail: "first element", apply: "first()" },
	{ label: "last()", detail: "last element", apply: "last()" },
	{ label: "length()", detail: "item count", apply: "length()" },
	{ label: "toString()", detail: "convert to string", apply: "toString()" },
];

/** Date method suggestions */
const DATE_METHODS: { label: string; detail: string; apply: string }[] = [
	{ label: "format()", detail: "format as string", apply: "format(" },
	{ label: "date()", detail: "date part YYYY-MM-DD", apply: "date()" },
	{ label: "time()", detail: "time part HH:mm:ss", apply: "time()" },
	{ label: "relative()", detail: "relative time (ago)", apply: "relative()" },
	{ label: "year()", detail: "year number", apply: "year()" },
	{ label: "month()", detail: "month number", apply: "month()" },
	{ label: "day()", detail: "day number", apply: "day()" },
	{ label: "hour()", detail: "hour number", apply: "hour()" },
	{ label: "minute()", detail: "minute number", apply: "minute()" },
	{ label: "second()", detail: "second number", apply: "second()" },
	{ label: "isEmpty()", detail: "check if invalid", apply: "isEmpty()" },
	{ label: "toString()", detail: "convert to string", apply: "toString()" },
];

/** Object method suggestions */
const OBJECT_METHODS: { label: string; detail: string; apply: string }[] = [
	{ label: "isEmpty()", detail: "check if empty", apply: "isEmpty()" },
	{ label: "keys()", detail: "get property names", apply: "keys()" },
	{ label: "values()", detail: "get values", apply: "values()" },
	{ label: "toString()", detail: "convert to string", apply: "toString()" },
];

/** Inferred type from expression context before a dot */
export type InferredType = "file" | "link" | "date" | "string" | "number" | "list" | "object" | "unknown";

/**
 * Infer the type of the expression preceding a dot for method suggestions.
 * Uses simple pattern matching on the text before the dot.
 */
export function inferTypeBeforeDot(textBeforeDot: string): InferredType {
	const trimmed = textBeforeDot.trimEnd();

	// Check for method calls that return known types
	if (trimmed.endsWith(".asFile()")) return "file";
	if (trimmed.endsWith(".asLink()")) return "link";
	if (trimmed.endsWith(".content()")) return "string";
	if (trimmed.endsWith(".toString()")) return "string";
	if (trimmed.endsWith(".join()") || /\.join\([^)]*\)$/.test(trimmed)) return "string";
	if (trimmed.endsWith(".split()") || /\.split\([^)]*\)$/.test(trimmed)) return "list";
	if (trimmed.endsWith(".keys()") || trimmed.endsWith(".values()")) return "list";
	if (trimmed.endsWith(".filter()") || /\.filter\([^)]*\)$/.test(trimmed)) return "list";
	if (trimmed.endsWith(".map()") || /\.map\([^)]*\)$/.test(trimmed)) return "list";
	if (trimmed.endsWith(".sort()") || /\.sort\([^)]*\)$/.test(trimmed)) return "list";
	if (trimmed.endsWith(".unique()")) return "list";
	if (trimmed.endsWith(".reverse()")) return "list";
	if (trimmed.endsWith(".flat()")) return "list";
	if (trimmed.endsWith(".slice()") || /\.slice\([^)]*\)$/.test(trimmed)) return "list";
	if (trimmed.endsWith(".length()")) return "number";
	if (trimmed.endsWith(".abs()") || trimmed.endsWith(".ceil()") || trimmed.endsWith(".floor()")) return "number";
	if (/\.round\([^)]*\)$/.test(trimmed)) return "number";
	if (trimmed.endsWith(".year()") || trimmed.endsWith(".month()") || trimmed.endsWith(".day()")) return "number";
	if (trimmed.endsWith(".hour()") || trimmed.endsWith(".minute()") || trimmed.endsWith(".second()")) return "number";
	if (trimmed.endsWith(".format()") || /\.format\([^)]*\)$/.test(trimmed)) return "string";
	if (trimmed.endsWith(".date()") || trimmed.endsWith(".time()") || trimmed.endsWith(".relative()")) return "string";

	// Check for global function calls that return known types
	if (/\blink\([^)]*\)$/.test(trimmed)) return "link";
	if (/\bfile\([^)]*\)$/.test(trimmed)) return "file";
	if (/\bnow\(\)$/.test(trimmed) || /\btoday\(\)$/.test(trimmed)) return "date";
	if (/\bdate\([^)]*\)$/.test(trimmed)) return "date";
	if (/\blist\([^)]*\)$/.test(trimmed)) return "list";
	if (/\bnumber\([^)]*\)$/.test(trimmed)) return "number";
	if (/\blength\([^)]*\)$/.test(trimmed)) return "number";
	if (/\bconcat\([^)]*\)$/.test(trimmed)) return "string";

	// Check for property access patterns (e.g., xxx.tags, xxx.links → list)
	if (trimmed.endsWith(".tags") || trimmed.endsWith(".links")) return "list";
	if (trimmed.endsWith(".size") || trimmed.endsWith(".ctime") || trimmed.endsWith(".mtime")) return "number";
	if (trimmed.endsWith(".name") || trimmed.endsWith(".basename") || trimmed.endsWith(".path")) return "string";
	if (trimmed.endsWith(".folder") || trimmed.endsWith(".ext")) return "string";
	if (trimmed.endsWith(".properties")) return "object";

	// Array index access like [0] → could be anything, but in cross-file context it's often a link
	if (/\[\d+\]$/.test(trimmed)) return "unknown";

	return "unknown";
}

/** Property suggestion with icon type */
interface PropertySuggestion {
	label: string;
	detail: string;
	iconType: string; // CM completion type for the icon
}

/** Built-in file property names — used to deduplicate against user properties */
const FILE_PROP_NAMES = new Set(FILE_PROPS.map(p => p.label));

/**
 * Convert TemplateVariable[] to PropertySuggestion[], filtering out any
 * names that collide with built-in file properties. File properties always
 * take priority over user-defined frontmatter properties of the same name.
 */
function variablesToSuggestions(vars: TemplateVariable[], excludeBuiltins = false): PropertySuggestion[] {
	const filtered = excludeBuiltins ? vars.filter(v => !FILE_PROP_NAMES.has(v.name)) : vars;
	return filtered.map(v => ({
		label: v.name,
		detail: "frontmatter property",
		iconType: propertyCompletionType(v.type),
	}));
}

/**
 * Get method/property suggestions for a given inferred type.
 */
export function getSuggestionsForType(type: InferredType, extraVariables: TemplateVariable[]): {
	methods: { label: string; detail: string; apply: string }[];
	properties: PropertySuggestion[];
} {
	switch (type) {
		case "file":
			return {
				methods: FILE_METHODS,
				properties: [
					...FILE_PROPS.map(p => ({ ...p, iconType: propertyCompletionType(FILE_PROP_TYPES[p.label] ?? "text") })),
					...variablesToSuggestions(extraVariables, true),
				],
			};
		case "link":
			return { methods: LINK_METHODS, properties: [] };
		case "date":
			return { methods: DATE_METHODS, properties: [] };
		case "string":
			return { methods: STRING_METHODS, properties: [] };
		case "number":
			return { methods: NUMBER_METHODS, properties: [] };
		case "list":
			return { methods: LIST_METHODS, properties: [] };
		case "object":
			return { methods: OBJECT_METHODS, properties: variablesToSuggestions(extraVariables) };
		case "unknown":
		default: {
			// Show all methods and properties from all types, deduplicated
			const seen = new Set<string>();
			const methods: { label: string; detail: string; apply: string }[] = [];
			const allMethodSets = [FILE_METHODS, LINK_METHODS, STRING_METHODS, NUMBER_METHODS, LIST_METHODS, DATE_METHODS, OBJECT_METHODS];
			for (const set of allMethodSets) {
				for (const m of set) {
					if (!seen.has(m.label)) {
						seen.add(m.label);
						methods.push(m);
					}
				}
			}
			return {
				methods,
				properties: [
					...FILE_PROPS.map(p => ({ ...p, iconType: propertyCompletionType(FILE_PROP_TYPES[p.label] ?? "text") })),
					...variablesToSuggestions(extraVariables, true),
				],
			};
		}
	}
}

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
				changes: { from, to, insert: "{}}" },
				selection: { anchor: from + 1 },
				annotations: Transaction.userEvent.of("input.autoclose"),
			});
		}
		return true;
	}
);

/**
 * Detect if partial expression text is in expression mode vs legacy pipe mode.
 * Expression mode: parens appear before any pipe outside quotes.
 * If ambiguous (neither parens nor pipes), defaults to expression mode.
 */
export function isExpressionContext(text: string): boolean {
	let inQuote = false;
	let quoteChar = '';
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (!inQuote && (ch === '"' || ch === "'")) {
			inQuote = true;
			quoteChar = ch;
		} else if (inQuote && ch === quoteChar) {
			inQuote = false;
		} else if (!inQuote) {
			if (ch === '(') return true;
			if (ch === '|') return false;
		}
	}
	// Ambiguous — default to expression mode per user preference
	return true;
}

/**
 * Find the position of the last pipe operator outside of quotes and parentheses.
 * Returns -1 if not found.
 */
function findLastPipeInExpr(text: string): number {
	let inQuote = false;
	let quoteChar = '';
	let parenDepth = 0;
	let lastPipe = -1;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (!inQuote && (ch === '"' || ch === "'")) {
			inQuote = true;
			quoteChar = ch;
		} else if (inQuote && ch === quoteChar) {
			inQuote = false;
		} else if (!inQuote) {
			if (ch === '(') parenDepth++;
			else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
			else if (ch === '|' && parenDepth === 0) lastPipe = i;
		}
	}
	return lastPipe;
}

/**
 * Find the position of the last dot outside of quotes and parentheses,
 * but allow dots inside balanced method chains (e.g., link("x").asFile().name).
 * Returns -1 if not found.
 */
function findLastDotInExpr(text: string): number {
	let inQuote = false;
	let quoteChar = '';
	let lastDot = -1;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (!inQuote && (ch === '"' || ch === "'")) {
			inQuote = true;
			quoteChar = ch;
		} else if (inQuote && ch === quoteChar) {
			inQuote = false;
		} else if (!inQuote && ch === '.') {
			lastDot = i;
		}
	}
	return lastDot;
}

/**
 * Creates a template variable/filter completion source.
 * Supports both legacy pipe-filter mode and Bases expression mode.
 * @param extraVariables — frontmatter property names from the vault
 */
export function templateCompletionSource(extraVariables: TemplateVariable[] = []) {
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

		// We're inside {{ ... }}
		const content = afterOpen.trimStart();
		const isExprMode = isExpressionContext(content);

		// --- Filter completion (after pipe) — works in both modes ---
		const pipeIndex = findLastPipeInExpr(content);
		if (pipeIndex !== -1) {
			const afterPipe = content.substring(pipeIndex + 1).trimStart();
			const filterWord = afterPipe.match(/^([a-zA-Z_]*)$/);
			if (filterWord) {
				const from = pos - filterWord[1].length;
				return {
					from,
					options: TEMPLATE_FILTERS.map(f => ({
						label: f.label,
						detail: f.detail,
						type: "function",
					})),
				};
			}
			return null;
		}

		// --- Expression mode ---
		if (isExprMode) {
			// Check for dot access (method/property completion)
			const dotIndex = findLastDotInExpr(content);
			if (dotIndex !== -1) {
				const beforeDot = content.substring(0, dotIndex);
				const afterDot = content.substring(dotIndex + 1);

				// Only complete if afterDot is a partial identifier (or empty)
				const partialWord = afterDot.match(/^([a-zA-Z_]*)$/);
				if (partialWord) {
					const typed = partialWord[1];
					const from = pos - typed.length;
					const inferredType = inferTypeBeforeDot(beforeDot);
					const { methods, properties } = getSuggestionsForType(inferredType, extraVariables);

					const options = [
						...methods.map(m => ({
							label: m.label,
							detail: m.detail,
							apply: m.apply,
							type: "function" as const,
						})),
						...properties.map(p => ({
							label: p.label,
							detail: p.detail,
							type: p.iconType,
						})),
					];
					return { from, options };
				}
			}

			// Check for comparison operator followed by partial word
			// (suggest frontmatter properties as comparison values)
			const compMatch = content.match(/(?:==|!=|>=|<=|>|<)\s*([a-zA-Z_]*)$/);
			if (compMatch) {
				const typed = compMatch[1];
				const from = pos - typed.length;
				const options = extraVariables.map(v => ({
					label: v.name,
					detail: "frontmatter property",
					type: propertyCompletionType(v.type),
				}));
				return { from, options };
			}

			// Root expression context — suggest functions + properties
			const rootWord = content.match(/^([a-zA-Z_.]*)$/);
			if (rootWord) {
				const typed = rootWord[1];
				const from = pos - typed.length;
				const options = [
					// Global functions
					...EXPR_FUNCTIONS.map(f => ({
						label: f.label,
						detail: f.detail,
						apply: f.apply,
						type: "function" as const,
					})),
					// file.* variables (legacy style, still useful)
					...FILE_VARIABLES.map(v => ({
						label: v.label,
						detail: v.detail,
						type: propertyCompletionType(FILE_PROP_TYPES[v.label.replace(/^file\./, "")] ?? "text"),
					})),
					// Frontmatter properties (accessible directly in expressions)
					...extraVariables.map(v => ({
						label: v.name,
						detail: "frontmatter property",
						type: propertyCompletionType(v.type),
					})),
				];
				return { from, options };
			}

			return null;
		}

		// --- Legacy pipe mode ---
		// Variable completion: property access with dots and brackets
		const varText = content;
		const varWord = varText.match(/^([a-zA-Z0-9_.[\]]*)$/);
		if (varWord) {
			const typed = varWord[1];

			// Cross-file chained property access (e.g., "cast[0].cover")
			const chainDotMatch = typed.match(/^(.*\[\d+\]\.)([a-zA-Z0-9_]*)$/);
			if (chainDotMatch) {
				const partialProp = chainDotMatch[2];
				const from = pos - partialProp.length;

				const seen = new Set<string>();
				const options: { label: string; detail: string; type: string }[] = [];
				for (const v of FILE_VARIABLES) {
					const shortLabel = v.label.replace(/^file\./, "");
					if (!seen.has(shortLabel)) {
						seen.add(shortLabel);
						options.push({ label: shortLabel, detail: v.detail, type: "property" });
					}
				}
				for (const v of extraVariables) {
					if (!seen.has(v.name)) {
						seen.add(v.name);
						options.push({ label: v.name, detail: "frontmatter property", type: propertyCompletionType(v.type) });
					}
				}

				return { from, options };
			}

			const from = pos - typed.length;
			const options = [
				...FILE_VARIABLES.map(v => ({
					label: v.label,
					detail: v.detail,
					type: propertyCompletionType(FILE_PROP_TYPES[v.label.replace(/^file\./, "")] ?? "text"),
				})),
				...extraVariables.map(v => ({
					label: v.name,
					detail: "frontmatter property",
					type: propertyCompletionType(v.type),
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
		// Completion icons — use Lucide SVGs via CSS mask-image
		".cm-completionIcon": {
			padding: "0",
			marginRight: "4px",
			width: "1em",
			opacity: "0.7",
		},
		".cm-completionIcon::after": {
			content: "' '",
			display: "inline-block",
			width: "24px",
			height: "24px",
			verticalAlign: "-2px",
			background: "currentColor",
			maskSize: "contain",
			maskRepeat: "no-repeat",
			WebkitMaskSize: "contain",
			WebkitMaskRepeat: "no-repeat",
		},
		// Function / method icon — Lucide square-function
		".cm-completionIcon-function::after": {
			maskImage: `url("${ICON_FUNCTION}")`,
			WebkitMaskImage: `url("${ICON_FUNCTION}")`,
		},
		// Text property icon — Lucide align-left/text
		".cm-completionIcon-cv-text::after": {
			maskImage: `url("${ICON_TEXT}")`,
			WebkitMaskImage: `url("${ICON_TEXT}")`,
		},
		// Number property icon — Lucide binary
		".cm-completionIcon-cv-number::after": {
			maskImage: `url("${ICON_NUMBER}")`,
			WebkitMaskImage: `url("${ICON_NUMBER}")`,
		},
		// Date property icon — Lucide calendar
		".cm-completionIcon-cv-date::after": {
			maskImage: `url("${ICON_DATE}")`,
			WebkitMaskImage: `url("${ICON_DATE}")`,
		},
		// Datetime property icon — Lucide clock
		".cm-completionIcon-cv-datetime::after": {
			maskImage: `url("${ICON_CLOCK}")`,
			WebkitMaskImage: `url("${ICON_CLOCK}")`,
		},
		// List property icon — Lucide list
		".cm-completionIcon-cv-list::after": {
			maskImage: `url("${ICON_LIST}")`,
			WebkitMaskImage: `url("${ICON_LIST}")`,
		},
		// Checkbox property icon — Lucide check-square
		".cm-completionIcon-cv-checkbox::after": {
			maskImage: `url("${ICON_CHECKBOX}")`,
			WebkitMaskImage: `url("${ICON_CHECKBOX}")`,
		},
		// File property icon — Lucide file
		".cm-completionIcon-cv-file::after": {
			maskImage: `url("${ICON_FILE}")`,
			WebkitMaskImage: `url("${ICON_FILE}")`,
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

export function buildEditorExtensions(lang: EditorLanguage = "html", extraTemplateVars: TemplateVariable[] = []): Extension[] {
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
	/** Extra template variables with type info for autocomplete icons */
	templateVariables?: TemplateVariable[];
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
