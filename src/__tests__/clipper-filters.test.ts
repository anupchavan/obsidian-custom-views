/**
 * Tests for new Clipper-style filters added to filters.ts
 *
 * Covers all filters added beyond the original 23:
 *   pascal, uncamel, map, unique, list, nth, merge, reverse, length,
 *   round, number_format, duration, callout, footnote, fragment_link,
 *   markdown, strip_md, table, remove_html, remove_tags, strip_attr,
 *   remove_attr, replace_tags, unescape, object, template, safe_name
 *
 * Run with:  npm test
 */

import { describe, it, expect } from "vitest";
import { applyFilterChain } from "../filters";

// ---------------------------------------------------------------------------
// String case filters
// ---------------------------------------------------------------------------

describe("pascal filter", () => {
	it("converts to PascalCase", () => {
		expect(applyFilterChain("hello world", "pascal")).toBe("HelloWorld");
	});

	it("converts kebab-case to PascalCase", () => {
		expect(applyFilterChain("my-variable-name", "pascal")).toBe("MyVariableName");
	});
});

describe("uncamel filter", () => {
	it("converts camelCase to spaced lowercase", () => {
		expect(applyFilterChain("myVariableName", "uncamel")).toBe("my variable name");
	});

	it("converts PascalCase to spaced lowercase", () => {
		expect(applyFilterChain("MyVariableName", "uncamel")).toBe("my variable name");
	});
});

// ---------------------------------------------------------------------------
// Array operations
// ---------------------------------------------------------------------------

describe("unique filter", () => {
	it("removes duplicates from array", () => {
		expect(applyFilterChain(["a", "b", "a", "c", "b"], "unique")).toEqual(["a", "b", "c"]);
	});

	it("returns non-array unchanged", () => {
		expect(applyFilterChain("hello", "unique")).toBe("hello");
	});
});

describe("list filter", () => {
	it("wraps non-array in array", () => {
		expect(applyFilterChain("hello", "list")).toEqual(["hello"]);
	});

	it("returns array unchanged", () => {
		expect(applyFilterChain(["a", "b"], "list")).toEqual(["a", "b"]);
	});
});

describe("nth filter", () => {
	it("returns element at index", () => {
		expect(applyFilterChain(["a", "b", "c"], "nth:1")).toBe("b");
	});

	it("returns first element by default", () => {
		expect(applyFilterChain(["x", "y", "z"], "nth")).toBe("x");
	});

	it("returns null for out-of-bounds", () => {
		expect(applyFilterChain(["a"], "nth:5")).toBe(null);
	});
});

describe("merge filter", () => {
	it("merges two arrays", () => {
		// merge with a single extra item (the filter gets it as a string arg)
		const result = applyFilterChain(["a", "b"], 'merge:"c"');
		expect(result).toEqual(["a", "b", "c"]);
	});
});

describe("reverse filter", () => {
	it("reverses an array", () => {
		expect(applyFilterChain(["a", "b", "c"], "reverse")).toEqual(["c", "b", "a"]);
	});

	it("reverses a string", () => {
		expect(applyFilterChain("hello", "reverse")).toBe("olleh");
	});
});

describe("length filter", () => {
	it("returns array length", () => {
		expect(applyFilterChain(["a", "b", "c"], "length")).toBe(3);
	});

	it("returns string length", () => {
		expect(applyFilterChain("hello", "length")).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// Numeric filters
// ---------------------------------------------------------------------------

describe("round filter", () => {
	it("rounds to integer by default", () => {
		expect(applyFilterChain(3.7, "round")).toBe(4);
	});

	it("rounds to specified decimals", () => {
		expect(applyFilterChain(3.14159, "round:2")).toBe(3.14);
	});
});

describe("number_format filter", () => {
	it("formats number with thousand separators", () => {
		expect(applyFilterChain(1234567, "number_format:0")).toBe("1,234,567");
	});

	it("formats with decimal places", () => {
		expect(applyFilterChain(1234.5, "number_format:2")).toBe("1,234.50");
	});
});

describe("duration filter", () => {
	it("formats milliseconds as duration", () => {
		const result = applyFilterChain(3661000, "duration");
		expect(result).toContain("1h");
		expect(result).toContain("1m");
		expect(result).toContain("1s");
	});

	it("returns 0s for zero", () => {
		expect(applyFilterChain(0, "duration")).toBe("0s");
	});
});

// ---------------------------------------------------------------------------
// Markdown filters
// ---------------------------------------------------------------------------

describe("callout filter", () => {
	it("wraps text in callout syntax", () => {
		const result = applyFilterChain("Important note", 'callout:"warning","Attention"') as string;
		expect(result).toContain("[!warning] Attention");
		expect(result).toContain("> Important note");
	});

	it("defaults to info type", () => {
		const result = applyFilterChain("Note text", "callout") as string;
		expect(result).toContain("[!info]");
	});
});

describe("footnote filter", () => {
	it("creates footnote syntax", () => {
		const result = applyFilterChain("This is a footnote", 'footnote:"1"') as string;
		expect(result).toBe("[^1]: This is a footnote");
	});
});

describe("fragment_link filter", () => {
	it("creates wiki-link with fragment", () => {
		const result = applyFilterChain("My Note", 'fragment_link:"Section 1"');
		expect(result).toBe("[[My Note#Section 1]]");
	});

	it("omits the hash when no fragment is provided", () => {
		const result = applyFilterChain("My Note", "fragment_link");
		expect(result).toBe("[[My Note]]");
	});
});

describe("markdown filter", () => {
	it("converts basic HTML to markdown", () => {
		expect(applyFilterChain("<strong>bold</strong>", "markdown")).toBe("**bold**");
	});

	it("converts links", () => {
		expect(applyFilterChain('<a href="https://example.com">Example</a>', "markdown")).toBe("[Example](https://example.com)");
	});

	it("wraps markdown link destinations that contain spaces", () => {
		expect(applyFilterChain('<a href="https://example.com/a b">Example</a>', "markdown")).toBe("[Example](<https://example.com/a b>)");
	});

	it("converts emphasis", () => {
		expect(applyFilterChain("<em>italic</em>", "markdown")).toBe("*italic*");
	});

	it("removes malformed nested HTML tags without exposing a new tag", () => {
		const result = applyFilterChain("<p>Hello</p><scr<script>ipt>alert</script>", "markdown") as string;
		expect(result).not.toContain("<script");
	});
});

describe("strip_md filter", () => {
	it("removes heading markers", () => {
		expect(applyFilterChain("## Heading", "strip_md")).toBe("Heading");
	});

	it("removes bold markers", () => {
		expect(applyFilterChain("**bold** text", "strip_md")).toBe("bold text");
	});

	it("removes italic markers", () => {
		expect(applyFilterChain("*italic* text", "strip_md")).toBe("italic text");
	});

	it("removes wiki-links", () => {
		expect(applyFilterChain("See [[My Note]]", "strip_md")).toBe("See My Note");
	});

	it("removes wiki-links with display text", () => {
		expect(applyFilterChain("See [[My Note|click here]]", "strip_md")).toBe("See click here");
	});

	it("removes markdown links", () => {
		expect(applyFilterChain("[text](url)", "strip_md")).toBe("text");
	});
});

describe("table filter", () => {
	it("does not crash on non-array", () => {
		expect(applyFilterChain("hello", "table")).toBe("hello");
	});
});

// ---------------------------------------------------------------------------
// HTML processing filters
// ---------------------------------------------------------------------------

describe("remove_html filter", () => {
	it("strips all HTML tags", () => {
		expect(applyFilterChain("<p>Hello <b>world</b></p>", "remove_html")).toBe("Hello world");
	});

	it("removes malformed nested tag fragments without exposing a new tag", () => {
		expect(applyFilterChain("<<script>alert(1)</script>", "remove_html")).toBe("alert(1)");
	});
});

describe("remove_tags filter", () => {
	it("removes specific tags with content", () => {
		expect(applyFilterChain('<p>Keep</p><script>remove</script>', 'remove_tags:"script"')).toBe("<p>Keep</p>");
	});
});

describe("strip_attr filter", () => {
	it("strips all attributes when no args", () => {
		expect(applyFilterChain('<p class="test" id="p1">Hello</p>', "strip_attr")).toBe("<p>Hello</p>");
	});

	it("strips specific attributes", () => {
		const result = applyFilterChain('<p class="test" id="p1">Hello</p>', 'strip_attr:"class"') as string;
		expect(result).not.toContain('class=');
		expect(result).toContain('id="p1"');
	});
});

describe("replace_tags filter", () => {
	it("replaces tag names", () => {
		expect(applyFilterChain("<b>bold</b>", 'replace_tags:"b","strong"')).toBe("<strong>bold</strong>");
	});
});

describe("unescape filter", () => {
	it("unescapes HTML entities", () => {
		expect(applyFilterChain("&lt;p&gt;Hello &amp; world&lt;/p&gt;", "unescape")).toBe("<p>Hello & world</p>");
	});

	it("unescapes quote entities", () => {
		expect(applyFilterChain("&quot;hello&quot;", "unescape")).toBe('"hello"');
	});

	it("does not double-unescape nested entities", () => {
		expect(applyFilterChain("&amp;lt;script&amp;gt;", "unescape")).toBe("&lt;script&gt;");
	});
});

// ---------------------------------------------------------------------------
// Utility filters
// ---------------------------------------------------------------------------

describe("template filter", () => {
	it("replaces {{value}} placeholder", () => {
		expect(applyFilterChain("world", 'template:"Hello {{value}}!"')).toBe("Hello world!");
	});
});

describe("safe_name filter", () => {
	it("removes unsafe filename characters", () => {
		expect(applyFilterChain('My File: "test" <2>', "safe_name")).toBe("My File- -test- -2-");
	});

	it("trims whitespace", () => {
		expect(applyFilterChain("  hello  ", "safe_name")).toBe("hello");
	});
});

// ---------------------------------------------------------------------------
// Filter chaining (new + old filters together)
// ---------------------------------------------------------------------------

describe("filter chaining with new filters", () => {
	it("chains reverse | upper", () => {
		expect(applyFilterChain("hello", "reverse | upper")).toBe("OLLEH");
	});

	it("chains split | unique | join", () => {
		expect(applyFilterChain("a,b,a,c", 'split:"," | unique | join:"-"')).toBe("a-b-c");
	});

	it("chains upper | safe_name", () => {
		expect(applyFilterChain("My: File", "upper | safe_name")).toBe("MY- FILE");
	});
});
