/**
 * Tests for src/filters.ts — applyFilterChain and every built-in filter,
 * including the Clipper-style ones.
 *
 * Run with:  npm test
 */
import { describe, it, expect, vi } from "vitest";
import { applyFilterChain } from "../filters";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand to call applyFilterChain without full type ceremony */
function apply(value: unknown, chain: string) {
	return applyFilterChain(value as Parameters<typeof applyFilterChain>[0], chain);
}

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

describe("applyFilterChain — basics", () => {
	it("returns the original value when chain is empty string", () => {
		expect(apply("hello", "")).toBe("hello");
	});

	it("returns the original value for an unknown filter name", () => {
		expect(apply("hello", "nonexistent_filter")).toBe("hello");
	});

	it("silently skips unknown filters in a chain and applies the rest", () => {
		expect(apply("hello", "nonexistent | upper")).toBe("HELLO");
	});
});

// ---------------------------------------------------------------------------
// Built-in filters: one row per input → output contract
// ---------------------------------------------------------------------------

describe("built-in filters", () => {
	it.each([
		// case
		["hello", "upper", "HELLO"],
		["HeLLo", "upper", "HELLO"],
		["HELLO", "lower", "hello"],
		["hello world", "capitalize", "Hello world"],
		["HELLO", "capitalize", "Hello"],
		["hello world", "title", "Hello World"],
		["hELLo WoRLD", "title", "Hello World"],
		["hello world", "camel", "helloWorld"],
		["foo-bar-baz", "camel", "fooBarBaz"],
		["HelloWorld", "kebab", "hello-world"],
		["hello world", "kebab", "hello-world"],
		["HelloWorld", "snake", "hello_world"],
		["hello world", "snake", "hello_world"],
		["  hello  ", "trim", "hello"],
		["hello", "trim", "hello"],
		// replace
		["hello world world", 'replace:"world","there"', "hello there there"],
		["1+1=2", 'replace:"+","plus"', "1plus1=2"],
		["hello123", 'replace:"/[0-9]+/g",""', "hello"],
		["Hello HELLO hello", 'replace:"/hello/gi","hi"', "hi hi hi"],
		["hello world", 'replace:"world"', "hello "],
		["Movies/Album", 'replace:"/"," - "', "Movies - Album"],
		["don't stop", 'replace:"don\'t","do"', "do stop"],
		// wikilink / link / image
		["My Note", "wikilink", "[[My Note]]"],
		["My Note", 'wikilink:"alias"', "[[My Note|alias]]"],
		[["A", "B"], "wikilink", "[[A]], [[B]]"],
		[["A", "B"], 'wikilink:"x"', "[[A|x]], [[B|x]]"],
		["https://example.com", "link", "[link](https://example.com)"],
		["https://example.com", 'link:"Click here"', "[Click here](https://example.com)"],
		["Music/Love and Machines.md", "link", "[link](<Music/Love and Machines.md>)"],
		[["https://a.com", "https://b.com"], "link", "[link](https://a.com), [link](https://b.com)"],
		["photo.png", "image", "![](photo.png)"],
		["photo.png", 'image:"My Photo"', "![My Photo](photo.png)"],
		["test 1.png", "image", "![](<test 1.png>)"],
		[["a.png", "b.png"], "image", "![](a.png)\n![](b.png)"],
		// blockquote
		["line1\nline2\nline3", "blockquote", "> line1\n> line2\n> line3"],
		["quote", "blockquote", "> quote"],
		// arrays
		["a,b,c", "split", ["a", "b", "c"]],
		["a|b|c", 'split:"|"', ["a", "b", "c"]],
		["hello", "split", ["hello"]],
		[["a", "b", "c"], "join", "a,b,c"],
		[["a", "b", "c"], 'join:" | "', "a | b | c"],
		["hello", "join", "hello"],
		[["x", "y", "z"], "first", "x"],
		["hello", "first", "hello"],
		[["x", "y", "z"], "last", "z"],
		["hello", "last", "hello"],
		["hello", "slice:1,3", "el"],
		[["a", "b", "c", "d"], "slice:1,3", ["b", "c"]],
		["hello", "slice:2", "llo"],
		[42, "slice:1", 42],
		[["a", "b", "c"], "count", 3],
		["hello", "count", 5],
		[[], "count", 0],
		// calc
		[10, 'calc:"+5"', 15],
		[10, 'calc:"-3"', 7],
		[4, 'calc:"*3"', 12],
		[10, 'calc:"/2"', 5],
		[2, 'calc:"^10"', 1024],
		[2, 'calc:"**10"', 1024],
		["hello", 'calc:"+1"', "hello"],
		[5, 'calc:"%2"', 5],
		// date / date_modify
		["2024-03-25", 'date:"MMM D YYYY"', "Mar 25 2024"],
		["not-a-date", "date", "not-a-date"],
		["2024-01-01", 'date_modify:"1 day"', "2024-01-02"],
		["2024-01-05", 'date_modify:"-4 days"', "2024-01-01"],
		["2024-01-31", 'date_modify:"1 month"', "2024-02-29"],
		["2023-03-15", 'date_modify:"1 year"', "2024-03-15"],
		["not-a-date", 'date_modify:"1 day"', "not-a-date"],
		// strip_tags (DOMParser via jsdom)
		["<b>hello</b> <i>world</i>", "strip_tags", "hello world"],
		["hello world", "strip_tags", "hello world"],
		["<<script>alert(1)</script>", "strip_tags", "alert(1)"],
		["&lt;img src=x onerror=alert(1)&gt;", "strip_tags", "&lt;img src=x onerror=alert(1)&gt;"],
		// chains
		["  hello world  ", "trim | upper", "HELLO WORLD"],
		["a,b,c", 'split | join:" "', "a b c"],
		["  hello world  ", 'trim | capitalize | replace:"world","there"', "Hello there"],
		["foo|bar", 'replace:"|","-"', "foo-bar"],
		[["b", "a"], 'sort | join:", "', "a, b"],
		["cat dog", 'replace:/cat|dog/g,"pet" | upper', "PET PET"],
		// Clipper-style filters
		["hello world", "pascal", "HelloWorld"],
		["my-variable-name", "pascal", "MyVariableName"],
		["myVariableName", "uncamel", "my variable name"],
		["MyVariableName", "uncamel", "my variable name"],
		[["a", "b", "a", "c", "b"], "unique", ["a", "b", "c"]],
		["hello", "unique", "hello"],
		["hello", "list", ["hello"]],
		[["a", "b"], "list", ["a", "b"]],
		[["a", "b", "c"], "nth:1", "b"],
		[["x", "y", "z"], "nth", "x"],
		[["a"], "nth:5", null],
		[["a", "b"], 'merge:"c"', ["a", "b", "c"]],
		[["a", "b", "c"], "reverse", ["c", "b", "a"]],
		["hello", "reverse", "olleh"],
		[["a", "b", "c"], "length", 3],
		["hello", "length", 5],
		[3.7, "round", 4],
		[3.14159, "round:2", 3.14],
		[1234567, "number_format:0", "1,234,567"],
		[1234.5, "number_format:2", "1,234.50"],
		[3661000, "duration", "1h 1m 1s"],
		[0, "duration", "0s"],
		["Important note", 'callout:"warning","Attention"', "> [!warning] Attention\n> Important note"],
		["Note text", "callout", "> [!info]\n> Note text"],
		["This is a footnote", 'footnote:"1"', "[^1]: This is a footnote"],
		["My Note", 'fragment_link:"Section 1"', "[[My Note#Section 1]]"],
		["My Note", "fragment_link", "[[My Note]]"],
		["<strong>bold</strong>", "markdown", "**bold**"],
		['<a href="https://example.com">Example</a>', "markdown", "[Example](https://example.com)"],
		['<a href="https://example.com/a b">Example</a>', "markdown", "[Example](<https://example.com/a b>)"],
		["<em>italic</em>", "markdown", "*italic*"],
		["## Heading", "strip_md", "Heading"],
		["**bold** text", "strip_md", "bold text"],
		["*italic* text", "strip_md", "italic text"],
		["See [[My Note]]", "strip_md", "See My Note"],
		["See [[My Note|click here]]", "strip_md", "See click here"],
		["[text](url)", "strip_md", "text"],
		["hello", "table", "hello"],
		["<p>Hello <b>world</b></p>", "remove_html", "Hello world"],
		["<<script>alert(1)</script>", "remove_html", "alert(1)"],
		["<p>Keep</p><script>remove</script>", 'remove_tags:"script"', "<p>Keep</p>"],
		['<p class="test" id="p1">Hello</p>', "strip_attr", "<p>Hello</p>"],
		['<p class="test" id="p1">Hello</p>', 'strip_attr:"class"', '<p id="p1">Hello</p>'],
		["<b>bold</b>", 'replace_tags:"b","strong"', "<strong>bold</strong>"],
		["&lt;p&gt;Hello &amp; world&lt;/p&gt;", "unescape", "<p>Hello & world</p>"],
		["&quot;hello&quot;", "unescape", '"hello"'],
		["&amp;lt;script&amp;gt;", "unescape", "&lt;script&gt;"],
		["world", 'template:"Hello {{value}}!"', "Hello world!"],
		['My File: "test" <2>', "safe_name", "My File- -test- -2-"],
		["  hello  ", "safe_name", "hello"],
		["hello", "reverse | upper", "OLLEH"],
		["a,b,a,c", 'split:"," | unique | join:"-"', "a-b-c"],
		["My: File", "upper | safe_name", "MY- FILE"],
	] as const)("%j | %s → %j", (value, chain, expected) => {
		expect(apply(value, chain)).toEqual(expected);
	});

	it("markdown removes malformed nested HTML without exposing a new tag", () => {
		expect(apply("<p>Hello</p><scr<script>ipt>alert</script>", "markdown")).not.toContain("<script");
	});

	it("formats timestamps in the local calendar day", () => {
		vi.stubEnv("TZ", "UTC");
		try {
			expect(apply(new Date("2024-06-15").getTime(), "date")).toBe("2024-06-15");
			expect(apply(new Date("2024-01-05T00:00:00Z").getTime(), 'date:"DD/MM/YYYY"')).toBe("05/01/2024");
		} finally { vi.unstubAllEnvs(); }
	});
});
