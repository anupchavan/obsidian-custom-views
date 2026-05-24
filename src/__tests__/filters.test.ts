/**
 * Tests for src/filters.ts — applyFilterChain and every built-in filter.
 *
 * Run with:  npm test
 */
import { describe, it, expect } from "vitest";
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
// String-case filters
// ---------------------------------------------------------------------------

describe("upper", () => {
	it("uppercases a string", () => expect(apply("hello", "upper")).toBe("HELLO"));
	it("handles already-uppercase input", () => expect(apply("HELLO", "upper")).toBe("HELLO"));
	it("handles mixed case", () => expect(apply("HeLLo", "upper")).toBe("HELLO"));
});

describe("lower", () => {
	it("lowercases a string", () => expect(apply("HELLO", "lower")).toBe("hello"));
	it("handles already-lowercase input", () => expect(apply("hello", "lower")).toBe("hello"));
});

describe("capitalize", () => {
	it("uppercases first char, lowercases rest", () => expect(apply("hello world", "capitalize")).toBe("Hello world"));
	it("handles all-caps input", () => expect(apply("HELLO", "capitalize")).toBe("Hello"));
});

describe("title", () => {
	it("title-cases each word", () => expect(apply("hello world", "title")).toBe("Hello World"));
	it("handles mixed-case words", () => expect(apply("hELLo WoRLD", "title")).toBe("Hello World"));
});

describe("camel", () => {
	it("converts space-separated to camelCase", () => expect(apply("hello world", "camel")).toBe("helloWorld"));
	it("handles hyphen-separated input", () => expect(apply("foo-bar-baz", "camel")).toBe("fooBarBaz"));
});

describe("kebab", () => {
	it("converts PascalCase to kebab-case", () => expect(apply("HelloWorld", "kebab")).toBe("hello-world"));
	it("converts space-separated to kebab-case", () => expect(apply("hello world", "kebab")).toBe("hello-world"));
});

describe("snake", () => {
	it("converts PascalCase to snake_case", () => expect(apply("HelloWorld", "snake")).toBe("hello_world"));
	it("converts space-separated to snake_case", () => expect(apply("hello world", "snake")).toBe("hello_world"));
});

describe("trim", () => {
	it("removes leading and trailing whitespace", () => expect(apply("  hello  ", "trim")).toBe("hello"));
	it("returns unchanged string if no whitespace", () => expect(apply("hello", "trim")).toBe("hello"));
});

// ---------------------------------------------------------------------------
// replace
// ---------------------------------------------------------------------------

describe("replace", () => {
	it("replaces a literal substring (all occurrences)", () => {
		expect(apply("hello world world", 'replace:"world","there"')).toBe("hello there there");
	});

	it("escapes regex meta-characters in the search string", () => {
		expect(apply("1+1=2", 'replace:"+","plus"')).toBe("1plus1=2");
	});

	it("uses regex when search starts with /", () => {
		expect(apply("hello123", 'replace:"/[0-9]+/g",""')).toBe("hello");
	});

	it("supports regex flags (case-insensitive)", () => {
		expect(apply("Hello HELLO hello", 'replace:"/hello/gi","hi"')).toBe("hi hi hi");
	});

	it("replaces with empty string when replacement arg is omitted", () => {
		expect(apply("hello world", 'replace:"world"')).toBe("hello ");
	});
});

// ---------------------------------------------------------------------------
// wikilink / link / image
// ---------------------------------------------------------------------------

describe("wikilink", () => {
	it("wraps value in [[ ]]", () => expect(apply("My Note", "wikilink")).toBe("[[My Note]]"));
	it("adds alias with pipe", () => expect(apply("My Note", 'wikilink:"alias"')).toBe("[[My Note|alias]]"));
	it("maps over an array", () => {
		expect(apply(["A", "B"], "wikilink")).toBe("[[A]], [[B]]");
	});
	it("array with alias", () => {
		expect(apply(["A", "B"], 'wikilink:"x"')).toBe("[[A|x]], [[B|x]]");
	});
});

describe("link", () => {
	it("creates markdown link with default label 'link'", () => {
		expect(apply("https://example.com", "link")).toBe("[link](https://example.com)");
	});
	it("uses custom label when provided", () => {
		expect(apply("https://example.com", 'link:"Click here"')).toBe("[Click here](https://example.com)");
	});
	it("maps over an array", () => {
		expect(apply(["https://a.com", "https://b.com"], "link")).toBe(
			"[link](https://a.com), [link](https://b.com)"
		);
	});
});

describe("image", () => {
	it("creates markdown image with empty alt by default", () => {
		expect(apply("photo.png", "image")).toBe("![](photo.png)");
	});
	it("uses custom alt text", () => {
		expect(apply("photo.png", 'image:"My Photo"')).toBe("![My Photo](photo.png)");
	});
	it("maps over an array (newline-separated)", () => {
		expect(apply(["a.png", "b.png"], "image")).toBe("![](a.png)\n![](b.png)");
	});
});

// ---------------------------------------------------------------------------
// blockquote
// ---------------------------------------------------------------------------

describe("blockquote", () => {
	it("prefixes each line with '> '", () => {
		expect(apply("line1\nline2\nline3", "blockquote")).toBe("> line1\n> line2\n> line3");
	});
	it("handles single-line input", () => {
		expect(apply("quote", "blockquote")).toBe("> quote");
	});
});

// ---------------------------------------------------------------------------
// Array helpers
// ---------------------------------------------------------------------------

describe("split", () => {
	it("splits on comma by default", () => {
		expect(apply("a,b,c", "split")).toEqual(["a", "b", "c"]);
	});
	it("splits on a custom separator", () => {
		expect(apply("a|b|c", 'split:"|"')).toEqual(["a", "b", "c"]);
	});
	it("returns single-element array when separator not found", () => {
		expect(apply("hello", "split")).toEqual(["hello"]);
	});
});

describe("join", () => {
	it("joins array with comma by default", () => {
		expect(apply(["a", "b", "c"], "join")).toBe("a,b,c");
	});
	it("joins with a custom separator", () => {
		expect(apply(["a", "b", "c"], 'join:" | "')).toBe("a | b | c");
	});
	it("returns non-array value unchanged", () => {
		expect(apply("hello", "join")).toBe("hello");
	});
});

describe("first", () => {
	it("returns first element of an array", () => expect(apply(["x", "y", "z"], "first")).toBe("x"));
	it("returns non-array value unchanged", () => expect(apply("hello", "first")).toBe("hello"));
});

describe("last", () => {
	it("returns last element of an array", () => expect(apply(["x", "y", "z"], "last")).toBe("z"));
	it("returns non-array value unchanged", () => expect(apply("hello", "last")).toBe("hello"));
});

describe("slice", () => {
	it("slices a string", () => expect(apply("hello", "slice:1,3")).toBe("el"));
	it("slices an array", () => expect(apply(["a", "b", "c", "d"], "slice:1,3")).toEqual(["b", "c"]));
	it("slices from index to end when end omitted", () => expect(apply("hello", "slice:2")).toBe("llo"));
	it("returns non-sliceable value unchanged", () => expect(apply(42, "slice:1")).toBe(42));
});

describe("count", () => {
	it("returns array length", () => expect(apply(["a", "b", "c"], "count")).toBe(3));
	it("returns string length", () => expect(apply("hello", "count")).toBe(5));
	it("returns 0 for empty array", () => expect(apply([], "count")).toBe(0));
});

// ---------------------------------------------------------------------------
// calc
// ---------------------------------------------------------------------------

describe("calc", () => {
	it("adds", () => expect(apply(10, "calc:\"+5\"")).toBe(15));
	it("subtracts", () => expect(apply(10, "calc:\"-3\"")).toBe(7));
	it("multiplies", () => expect(apply(4, "calc:\"*3\"")).toBe(12));
	it("divides", () => expect(apply(10, "calc:\"/2\"")).toBe(5));
	it("raises to power with ^", () => expect(apply(2, "calc:\"^10\"")).toBe(1024));
	it("raises to power with **", () => expect(apply(2, "calc:\"**10\"")).toBe(1024));
	it("returns original value for non-numeric input", () => {
		expect(apply("hello", "calc:\"+1\"")).toBe("hello");
	});
	it("returns original value for unrecognised operator", () => {
		expect(apply(5, "calc:\"%2\"")).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// date / date_modify
// ---------------------------------------------------------------------------

describe("date", () => {
	it("formats a unix timestamp (ms) to YYYY-MM-DD by default", () => {
		const ts = new Date("2024-06-15").getTime(); // UTC midnight
		const result = apply(ts, "date");
		// Accept either 2024-06-14 or 2024-06-15 depending on timezone offset
		expect(result).toMatch(/^2024-06-1[45]$/);
	});

	it("formats with a custom format string", () => {
		const ts = new Date("2024-01-05T00:00:00Z").getTime();
		const result = String(apply(ts, 'date:"DD/MM/YYYY"'));
		// The day part may shift ±1 from timezone; just check month/year
		expect(result).toMatch(/^\d{2}\/01\/2024$/);
	});

	it("parses a YYYY-MM-DD string and reformats it", () => {
		expect(apply("2024-03-25", 'date:"MMM D YYYY"')).toBe("Mar 25 2024");
	});

	it("returns original value when input is invalid", () => {
		expect(apply("not-a-date", "date")).toBe("not-a-date");
	});
});

describe("date_modify", () => {
	it("adds days", () => {
		expect(apply("2024-01-01", 'date_modify:"1 day"')).toBe("2024-01-02");
	});
	it("subtracts days", () => {
		expect(apply("2024-01-05", 'date_modify:"-4 days"')).toBe("2024-01-01");
	});
	it("adds months", () => {
		expect(apply("2024-01-31", 'date_modify:"1 month"')).toBe("2024-02-29"); // 2024 is leap year
	});
	it("adds years", () => {
		expect(apply("2023-03-15", 'date_modify:"1 year"')).toBe("2024-03-15");
	});
	it("returns original value for invalid date input", () => {
		expect(apply("not-a-date", 'date_modify:"1 day"')).toBe("not-a-date");
	});
});

// ---------------------------------------------------------------------------
// strip_tags (requires DOMParser via jsdom)
// ---------------------------------------------------------------------------

describe("strip_tags", () => {
	it("removes HTML tags from a string", () => {
		expect(apply("<b>hello</b> <i>world</i>", "strip_tags")).toBe("hello world");
	});
	it("returns plain text unchanged", () => {
		expect(apply("hello world", "strip_tags")).toBe("hello world");
	});
});

// ---------------------------------------------------------------------------
// Filter chaining
// ---------------------------------------------------------------------------

describe("filter chaining", () => {
	it("applies filters left to right", () => {
		expect(apply("  hello world  ", "trim | upper")).toBe("HELLO WORLD");
	});

	it("split then join with different separator", () => {
		expect(apply("a,b,c", 'split | join:" "')).toBe("a b c");
	});

	it("handles three-step chain", () => {
		// capitalize lowercases everything after the first char, so "world" stays lowercase
		expect(apply("  hello world  ", 'trim | capitalize | replace:"world","there"')).toBe("Hello there");
	});

	it("handles quoted pipes inside filter arguments (does not split on them)", () => {
		// The | inside quotes must NOT be treated as a step separator
		expect(apply("foo|bar", 'replace:"|","-"')).toBe("foo-bar");
	});
});
