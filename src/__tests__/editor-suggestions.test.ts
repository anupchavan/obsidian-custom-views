/**
 * Tests for expression-mode autocomplete suggestions in editor.ts
 *
 * Tests:
 *   - isExpressionContext mode detection
 *   - inferTypeBeforeDot type inference
 *   - getSuggestionsForType suggestion catalogs
 *   - templateCompletionSource integration (via mocked CompletionContext)
 *
 * Run with: npm test
 */

import { describe, it, expect } from "vitest";
import {
	isExpressionContext,
	inferTypeBeforeDot,
	getSuggestionsForType,
	templateCompletionSource,
} from "../editor";
import type { TemplateVariable } from "../editor";
import type { CompletionContext } from "@codemirror/autocomplete";

/** Helper to create typed test variables */
const testVars: TemplateVariable[] = [
	{ name: "album", type: "text" },
	{ name: "rating", type: "number" },
	{ name: "genre", type: "list" },
];

// ---------------------------------------------------------------------------
// isExpressionContext
// ---------------------------------------------------------------------------

describe("isExpressionContext", () => {
	it("returns true for function call syntax", () => {
		expect(isExpressionContext("link(")).toBe(true);
		expect(isExpressionContext('link("Books")')).toBe(true);
		expect(isExpressionContext("now()")).toBe(true);
	});

	it("returns false for pipe-filter syntax", () => {
		expect(isExpressionContext("title | upper")).toBe(false);
		expect(isExpressionContext("file.name | kebab")).toBe(false);
	});

	it("returns true when paren comes before pipe", () => {
		expect(isExpressionContext('link("x").asFile() | upper')).toBe(true);
	});

	it("returns false when pipe comes before paren", () => {
		// This would be legacy mode with a filter that has parens
		expect(isExpressionContext("name | slice(0")).toBe(false);
	});

	it("ignores parens inside quotes", () => {
		expect(isExpressionContext('"hello(world)" | upper')).toBe(false);
	});

	it("ignores pipes inside quotes", () => {
		expect(isExpressionContext('"a|b"')).toBe(true); // no unquoted pipe → expression mode
	});

	it("defaults to expression mode when ambiguous", () => {
		expect(isExpressionContext("title")).toBe(true);
		expect(isExpressionContext("")).toBe(true);
		expect(isExpressionContext("file.name")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// inferTypeBeforeDot
// ---------------------------------------------------------------------------

describe("inferTypeBeforeDot", () => {
	// File type inference
	it("infers file from .asFile()", () => {
		expect(inferTypeBeforeDot('link("Books").asFile()')).toBe("file");
	});

	it("infers file from file() function", () => {
		expect(inferTypeBeforeDot('file("Books")')).toBe("file");
	});

	// Link type inference
	it("infers link from link() function", () => {
		expect(inferTypeBeforeDot('link("Books")')).toBe("link");
	});

	it("infers link from .asLink()", () => {
		expect(inferTypeBeforeDot('file("x").asLink()')).toBe("link");
	});

	// Date type inference
	it("infers date from now()", () => {
		expect(inferTypeBeforeDot("now()")).toBe("date");
	});

	it("infers date from today()", () => {
		expect(inferTypeBeforeDot("today()")).toBe("date");
	});

	it("infers date from date()", () => {
		expect(inferTypeBeforeDot('date("2024-01-01")')).toBe("date");
	});

	// String type inference
	it("infers string from .content()", () => {
		expect(inferTypeBeforeDot('file("x").content()')).toBe("string");
	});

	it("infers string from .toString()", () => {
		expect(inferTypeBeforeDot("something.toString()")).toBe("string");
	});

	it("infers string from .join()", () => {
		expect(inferTypeBeforeDot('tags.join(",")')).toBe("string");
	});

	it("infers string from concat()", () => {
		expect(inferTypeBeforeDot('concat("a","b")')).toBe("string");
	});

	it("infers string from .format()", () => {
		expect(inferTypeBeforeDot('now().format("YYYY")')).toBe("string");
	});

	it("infers string from .name property", () => {
		expect(inferTypeBeforeDot('file("x").name')).toBe("string");
	});

	it("infers string from .basename property", () => {
		expect(inferTypeBeforeDot('file("x").basename')).toBe("string");
	});

	it("infers string from .path property", () => {
		expect(inferTypeBeforeDot('file("x").path')).toBe("string");
	});

	it("infers string from .folder property", () => {
		expect(inferTypeBeforeDot('file("x").folder')).toBe("string");
	});

	it("infers string from .ext property", () => {
		expect(inferTypeBeforeDot('file("x").ext')).toBe("string");
	});

	// Number type inference
	it("infers number from .length()", () => {
		expect(inferTypeBeforeDot("tags.length()")).toBe("number");
	});

	it("infers number from length() function", () => {
		expect(inferTypeBeforeDot('length("hello")')).toBe("number");
	});

	it("infers number from .abs()", () => {
		expect(inferTypeBeforeDot("x.abs()")).toBe("number");
	});

	it("infers number from .ceil()", () => {
		expect(inferTypeBeforeDot("x.ceil()")).toBe("number");
	});

	it("infers number from .floor()", () => {
		expect(inferTypeBeforeDot("x.floor()")).toBe("number");
	});

	it("infers number from .round()", () => {
		expect(inferTypeBeforeDot("x.round(2)")).toBe("number");
	});

	it("infers number from .year()", () => {
		expect(inferTypeBeforeDot("now().year()")).toBe("number");
	});

	it("infers number from .size property", () => {
		expect(inferTypeBeforeDot('file("x").size')).toBe("number");
	});

	it("infers number from .ctime property", () => {
		expect(inferTypeBeforeDot('file("x").ctime')).toBe("number");
	});

	it("infers number from .mtime property", () => {
		expect(inferTypeBeforeDot('file("x").mtime')).toBe("number");
	});

	it("infers number from number() function", () => {
		expect(inferTypeBeforeDot('number("42")')).toBe("number");
	});

	// List type inference
	it("infers list from list() function", () => {
		expect(inferTypeBeforeDot('list("a","b")')).toBe("list");
	});

	it("infers list from .split()", () => {
		expect(inferTypeBeforeDot('name.split(",")')).toBe("list");
	});

	it("infers list from .keys()", () => {
		expect(inferTypeBeforeDot("obj.keys()")).toBe("list");
	});

	it("infers list from .values()", () => {
		expect(inferTypeBeforeDot("obj.values()")).toBe("list");
	});

	it("infers list from .filter()", () => {
		expect(inferTypeBeforeDot("tags.filter()")).toBe("list");
	});

	it("infers list from .map()", () => {
		expect(inferTypeBeforeDot('items.map("name")')).toBe("list");
	});

	it("infers list from .sort()", () => {
		expect(inferTypeBeforeDot("items.sort()")).toBe("list");
	});

	it("infers list from .unique()", () => {
		expect(inferTypeBeforeDot("tags.unique()")).toBe("list");
	});

	it("infers list from .reverse()", () => {
		expect(inferTypeBeforeDot("items.reverse()")).toBe("list");
	});

	it("infers list from .flat()", () => {
		expect(inferTypeBeforeDot("items.flat()")).toBe("list");
	});

	it("infers list from .tags property", () => {
		expect(inferTypeBeforeDot('file("x").tags')).toBe("list");
	});

	it("infers list from .links property", () => {
		expect(inferTypeBeforeDot('file("x").links')).toBe("list");
	});

	// Object type inference
	it("infers object from .properties", () => {
		expect(inferTypeBeforeDot('file("x").properties')).toBe("object");
	});

	// Unknown type
	it("returns unknown for bare identifiers", () => {
		expect(inferTypeBeforeDot("myVariable")).toBe("unknown");
	});

	it("returns unknown for array index access", () => {
		expect(inferTypeBeforeDot("cast[0]")).toBe("unknown");
	});
});

// ---------------------------------------------------------------------------
// getSuggestionsForType
// ---------------------------------------------------------------------------

describe("getSuggestionsForType", () => {
	const extras: TemplateVariable[] = testVars;

	it("returns file methods and properties for file type", () => {
		const { methods, properties } = getSuggestionsForType("file", extras);
		const methodLabels = methods.map(m => m.label);
		const propLabels = properties.map(p => p.label);

		expect(methodLabels).toContain("content()");
		expect(methodLabels).toContain("asLink()");
		expect(methodLabels).toContain("hasTag()");
		expect(methodLabels).toContain("hasProperty()");
		expect(methodLabels).toContain("inFolder()");

		expect(propLabels).toContain("name");
		expect(propLabels).toContain("basename");
		expect(propLabels).toContain("ctime");
		expect(propLabels).toContain("tags");
		// Extra variables are included as properties
		expect(propLabels).toContain("album");
		expect(propLabels).toContain("rating");
	});

	it("returns link methods for link type", () => {
		const { methods, properties } = getSuggestionsForType("link", extras);
		const labels = methods.map(m => m.label);

		expect(labels).toContain("asFile()");
		expect(labels).toContain("linksTo()");
		expect(properties).toHaveLength(0);
	});

	it("returns date methods for date type", () => {
		const { methods } = getSuggestionsForType("date", extras);
		const labels = methods.map(m => m.label);

		expect(labels).toContain("format()");
		expect(labels).toContain("date()");
		expect(labels).toContain("time()");
		expect(labels).toContain("relative()");
		expect(labels).toContain("year()");
	});

	it("returns string methods for string type", () => {
		const { methods } = getSuggestionsForType("string", extras);
		const labels = methods.map(m => m.label);

		expect(labels).toContain("contains()");
		expect(labels).toContain("upper()");
		expect(labels).toContain("lower()");
		expect(labels).toContain("split()");
		expect(labels).toContain("replace()");
	});

	it("returns number methods for number type", () => {
		const { methods } = getSuggestionsForType("number", extras);
		const labels = methods.map(m => m.label);

		expect(labels).toContain("abs()");
		expect(labels).toContain("ceil()");
		expect(labels).toContain("floor()");
		expect(labels).toContain("round()");
		expect(labels).toContain("toFixed()");
	});

	it("returns list methods for list type", () => {
		const { methods } = getSuggestionsForType("list", extras);
		const labels = methods.map(m => m.label);

		expect(labels).toContain("contains()");
		expect(labels).toContain("filter()");
		expect(labels).toContain("join()");
		expect(labels).toContain("map()");
		expect(labels).toContain("sort()");
		expect(labels).toContain("unique()");
		expect(labels).toContain("first()");
		expect(labels).toContain("last()");
	});

	it("returns object methods for object type", () => {
		const { methods, properties } = getSuggestionsForType("object", extras);
		const labels = methods.map(m => m.label);

		expect(labels).toContain("keys()");
		expect(labels).toContain("values()");
		expect(labels).toContain("isEmpty()");
		// Extra vars as properties
		const propLabels = properties.map(p => p.label);
		expect(propLabels).toContain("album");
	});

	it("returns all methods deduplicated for unknown type", () => {
		const { methods, properties } = getSuggestionsForType("unknown", extras);
		const labels = methods.map(m => m.label);

		// Should have methods from multiple types
		expect(labels).toContain("content()");    // file
		expect(labels).toContain("asFile()");      // link
		expect(labels).toContain("format()");      // date
		expect(labels).toContain("upper()");       // string
		expect(labels).toContain("abs()");         // number
		expect(labels).toContain("filter()");      // list
		expect(labels).toContain("keys()");        // object

		// No duplicates
		const uniqueLabels = new Set(labels);
		expect(uniqueLabels.size).toBe(labels.length);

		// Properties include file props and extras
		const propLabels = properties.map(p => p.label);
		expect(propLabels).toContain("basename");
		expect(propLabels).toContain("album");
	});

	it("deduplicates user properties that match built-in file property names", () => {
		// User has frontmatter properties named "ctime", "basename", "tags" — same as file builtins
		const conflicting: TemplateVariable[] = [
			{ name: "ctime", type: "text" },      // conflicts with file.ctime
			{ name: "basename", type: "text" },    // conflicts with file.basename
			{ name: "tags", type: "list" },         // conflicts with file.tags
			{ name: "myCustomProp", type: "text" }, // no conflict
		];

		// In file context, built-in wins, user duplicate filtered out
		const { properties } = getSuggestionsForType("file", conflicting);
		const propLabels = properties.map(p => p.label);

		// Each name appears exactly once
		expect(propLabels.filter(l => l === "ctime")).toHaveLength(1);
		expect(propLabels.filter(l => l === "basename")).toHaveLength(1);
		expect(propLabels.filter(l => l === "tags")).toHaveLength(1);

		// The built-in version is used (not "frontmatter property")
		const ctimeProp = properties.find(p => p.label === "ctime");
		expect(ctimeProp!.detail).not.toBe("frontmatter property");

		// Non-conflicting user property still included
		expect(propLabels).toContain("myCustomProp");
	});

	it("deduplicates in unknown type context too", () => {
		const conflicting: TemplateVariable[] = [
			{ name: "name", type: "text" },
			{ name: "size", type: "number" },
			{ name: "uniqueProp", type: "date" },
		];
		const { properties } = getSuggestionsForType("unknown", conflicting);
		const propLabels = properties.map(p => p.label);

		expect(propLabels.filter(l => l === "name")).toHaveLength(1);
		expect(propLabels.filter(l => l === "size")).toHaveLength(1);
		expect(propLabels).toContain("uniqueProp");
	});

	it("does not deduplicate in non-file contexts", () => {
		// In object context, there are no built-in file props, so no dedup needed
		const vars: TemplateVariable[] = [
			{ name: "ctime", type: "text" },
			{ name: "name", type: "text" },
		];
		const { properties } = getSuggestionsForType("object", vars);
		const propLabels = properties.map(p => p.label);

		expect(propLabels).toContain("ctime");
		expect(propLabels).toContain("name");
	});

	it("includes apply field for methods", () => {
		const { methods } = getSuggestionsForType("file", []);
		const content = methods.find(m => m.label === "content()");
		expect(content).toBeDefined();
		expect(content!.apply).toBe("content()");

		const hasTag = methods.find(m => m.label === "hasTag()");
		expect(hasTag).toBeDefined();
		expect(hasTag!.apply).toBe("hasTag(");
	});
});

// ---------------------------------------------------------------------------
// templateCompletionSource integration tests
// ---------------------------------------------------------------------------

/**
 * Minimal mock of CompletionContext for testing.
 * Only implements the fields used by templateCompletionSource.
 */
function mockCompletionContext(fullText: string, cursorPos?: number): CompletionContext {
	const pos = cursorPos ?? fullText.length;
	return {
		state: {
			doc: {
				lineAt: (_p: number) => ({ from: 0 }),
			},
			sliceDoc: (from: number, to: number) => fullText.substring(from, to),
		},
		pos,
		explicit: true,
		matchBefore: () => null,
	} as unknown as CompletionContext;
}

describe("templateCompletionSource integration", () => {
	const source = templateCompletionSource(testVars);

	it("returns null outside template braces", () => {
const result = source(mockCompletionContext("hello world"));
		expect(result).toBeNull();
	});

	it("returns null after closed braces", () => {
const result = source(mockCompletionContext("{{title}} more"));
		expect(result).toBeNull();
	});

	it("returns root suggestions inside empty braces", () => {
const result = source(mockCompletionContext("{{"));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);
		// Should have functions
		expect(labels).toContain("link()");
		expect(labels).toContain("now()");
		expect(labels).toContain("if()");
		// Should have file.* variables
		expect(labels).toContain("file.basename");
		expect(labels).toContain("file.ctime");
		// Should have frontmatter props
		expect(labels).toContain("album");
		expect(labels).toContain("rating");
	});

	it("root suggestions have correct types for icons", () => {
const result = source(mockCompletionContext("{{"));
		expect(result).not.toBeNull();
		const linkFn = result!.options.find(o => o.label === "link()");
		expect(linkFn).toBeDefined();
		expect(linkFn!.type).toBe("function");

		const fileProp = result!.options.find(o => o.label === "file.basename");
		expect(fileProp).toBeDefined();
		expect(fileProp!.type).toBe("cv-text");

		const albumProp = result!.options.find(o => o.label === "album");
		expect(albumProp).toBeDefined();
		expect(albumProp!.type).toBe("cv-text"); // text type

		const ratingProp = result!.options.find(o => o.label === "rating");
		expect(ratingProp).toBeDefined();
		expect(ratingProp!.type).toBe("cv-number"); // number type

		const genreProp = result!.options.find(o => o.label === "genre");
		expect(genreProp).toBeDefined();
		expect(genreProp!.type).toBe("cv-list"); // list type

		// file.ctime should get datetime icon
		const ctimeProp = result!.options.find(o => o.label === "file.ctime");
		expect(ctimeProp).toBeDefined();
		expect(ctimeProp!.type).toBe("cv-datetime");
	});

	it("suggests functions with apply field for cursor positioning", () => {
const result = source(mockCompletionContext("{{l"));
		expect(result).not.toBeNull();
		const linkFn = result!.options.find(o => o.label === "link()");
		expect(linkFn).toBeDefined();
		expect(linkFn!.apply).toBe("link(");

		const nowFn = result!.options.find(o => o.label === "now()");
		expect(nowFn).toBeDefined();
		expect(nowFn!.apply).toBe("now()");
	});

	it("suggests file methods/properties after .asFile().", () => {
		const text = '{{link("Books").asFile().';
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);

		// File methods
		expect(labels).toContain("content()");
		expect(labels).toContain("asLink()");
		expect(labels).toContain("hasTag()");
		// File properties
		expect(labels).toContain("basename");
		expect(labels).toContain("ctime");
		expect(labels).toContain("tags");
		// Frontmatter properties included for file type
		expect(labels).toContain("album");

		// Should NOT have link methods
		expect(labels).not.toContain("asFile()");
		expect(labels).not.toContain("linksTo()");
	});

	it("suggests link methods after link().", () => {
		const text = '{{link("Books").';
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);

		expect(labels).toContain("asFile()");
		expect(labels).toContain("linksTo()");
		// Should NOT have file-specific methods
		expect(labels).not.toContain("content()");
		expect(labels).not.toContain("hasTag()");
	});

	it("suggests date methods after now().", () => {
		const text = "{{now().";
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);

		expect(labels).toContain("format()");
		expect(labels).toContain("year()");
		expect(labels).toContain("relative()");
	});

	it("suggests string methods after .content().", () => {
		const text = '{{file("x").content().';
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);

		expect(labels).toContain("upper()");
		expect(labels).toContain("lower()");
		expect(labels).toContain("split()");
		expect(labels).toContain("contains()");
	});

	it("suggests list methods after .split().", () => {
		const text = '{{name.split(",").';
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);

		expect(labels).toContain("join()");
		expect(labels).toContain("filter()");
		expect(labels).toContain("sort()");
		expect(labels).toContain("first()");
		expect(labels).toContain("unique()");
	});

	it("suggests number methods after .length().", () => {
		const text = "{{tags.length().";
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);

		expect(labels).toContain("abs()");
		expect(labels).toContain("round()");
		expect(labels).toContain("toFixed()");
	});

	it("suggests frontmatter properties after comparison operator", () => {
		const text = '{{link("Books").asFile().ctime == ';
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);

		expect(labels).toContain("album");
		expect(labels).toContain("rating");
		expect(labels).toContain("genre");
		// Should only have frontmatter props, not functions
		expect(labels).not.toContain("link()");
	});

	it("suggests filters after pipe in legacy mode", () => {
		const text = "{{title | ";
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);

		expect(labels).toContain("upper");
		expect(labels).toContain("lower");
		expect(labels).toContain("capitalize");
		expect(labels).toContain("date");
		expect(labels).toContain("split");
		// New filters too
		expect(labels).toContain("pascal");
		expect(labels).toContain("strip_md");
		expect(labels).toContain("unique");
	});

	it("suggests filters after pipe in expression mode too", () => {
		const text = '{{link("x").asFile().basename | ';
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);

		expect(labels).toContain("upper");
		expect(labels).toContain("kebab");
	});

	it("suggests legacy variables in pipe mode", () => {
		// When pipe is present, we're in legacy mode — the text before pipe
		// is the variable context. But the completion targets the filter.
		// Let's test that typing the variable before a pipe works in legacy mode.
		const text = "{{file.";
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		// In expression mode (no pipe yet), dot triggers method suggestions
		// Since "file" isn't a recognized type producer, it'll be "unknown"
		// and show all methods + file props
		const labels = result!.options.map(o => o.label);
		expect(labels).toContain("basename");
		expect(labels).toContain("name");
	});

	it("suggests cross-file properties after [0]. in legacy mode", () => {
		// Text with pipe after bracket → legacy mode
		const text = "{{cast[0].";
		// In expression mode (default when ambiguous), [0]. should work
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);
		expect(labels).toContain("basename");
		expect(labels).toContain("album");
	});

	it("handles partial word after dot for filtering", () => {
		const text = '{{link("Books").asFile().ba';
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		// The `from` should be at the start of "ba"
		expect(result!.from).toBe(text.length - 2);
		const labels = result!.options.map(o => o.label);
		expect(labels).toContain("basename");
	});

	it("dot suggestions have correct types", () => {
		const text = '{{link("Books").asFile().';
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();

		const contentMethod = result!.options.find(o => o.label === "content()");
		expect(contentMethod!.type).toBe("function");

		const basenameProp = result!.options.find(o => o.label === "basename");
		expect(basenameProp!.type).toBe("cv-text");

		const ctimeProp = result!.options.find(o => o.label === "ctime");
		expect(ctimeProp!.type).toBe("cv-datetime");

		const tagsProp = result!.options.find(o => o.label === "tags");
		expect(tagsProp!.type).toBe("cv-list");

		const sizeProp = result!.options.find(o => o.label === "size");
		expect(sizeProp!.type).toBe("cv-number");

		// Frontmatter properties also have correct types
		const ratingProp = result!.options.find(o => o.label === "rating");
		expect(ratingProp!.type).toBe("cv-number");
	});

	it("filter suggestions have function type for icons", () => {
		const text = "{{title | u";
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const upper = result!.options.find(o => o.label === "upper");
		expect(upper!.type).toBe("function");
	});

	it("handles today().", () => {
		const text = "{{today().";
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);
		expect(labels).toContain("format()");
		expect(labels).toContain("year()");
	});

	it("handles chained methods like .asFile().content().", () => {
		const text = '{{link("x").asFile().content().';
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);
		// content() returns string
		expect(labels).toContain("upper()");
		expect(labels).toContain("split()");
	});

	it("handles .tags. (list property on file)", () => {
		const text = '{{file("x").tags.';
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);
		// tags is a list
		expect(labels).toContain("join()");
		expect(labels).toContain("filter()");
		expect(labels).toContain("length()");
	});

	it("handles != comparison operator", () => {
		const text = "{{rating != ";
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
		const labels = result!.options.map(o => o.label);
		expect(labels).toContain("album");

		// Comparison suggestions also have typed icons
		const albumOpt = result!.options.find(o => o.label === "album");
		expect(albumOpt!.type).toBe("cv-text");
		const ratingOpt = result!.options.find(o => o.label === "rating");
		expect(ratingOpt!.type).toBe("cv-number");
	});

	it("handles >= comparison operator", () => {
		const text = "{{rating >= ";
const result = source(mockCompletionContext(text));
		expect(result).not.toBeNull();
	});
});
