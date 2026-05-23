/**
 * Tests for renderer.ts — pure utility functions.
 *
 * Covers:
 *   - templateHasEditableContent — detecting unfiltered content placeholders
 *   - findFirstPipe — locating pipe chars outside quotes
 *   - resultToString — converting values to display strings
 *   - parsePropertyPath — parsing dotted/bracketed property chains
 *   - extractWikiLink — pulling link targets from [[wiki-link]] syntax
 *
 * Run with:  npm test
 */
import { describe, it, expect } from "vitest";
import {
	templateHasEditableContent,
	findFirstPipe,
	resultToString,
	parsePropertyPath,
	extractWikiLink,
} from "../renderer";

// ---------------------------------------------------------------------------
// templateHasEditableContent
// ---------------------------------------------------------------------------

describe("templateHasEditableContent", () => {
	it("returns true for {{file.content}}", () => {
		expect(templateHasEditableContent("<div>{{file.content}}</div>")).toBe(true);
	});

	it("returns true for {{content}}", () => {
		expect(templateHasEditableContent("<div>{{content}}</div>")).toBe(true);
	});

	it("returns true with extra whitespace", () => {
		expect(templateHasEditableContent("<div>{{ file.content }}</div>")).toBe(true);
	});

	it("returns false when content has a pipe filter", () => {
		expect(templateHasEditableContent("<div>{{file.content | upper}}</div>")).toBe(false);
	});

	it("returns false when content has a pipe filter (no file. prefix)", () => {
		expect(templateHasEditableContent("<div>{{content | truncate(100)}}</div>")).toBe(false);
	});

	it("returns false when no content placeholder exists", () => {
		expect(templateHasEditableContent("<div>{{title}}</div>")).toBe(false);
	});

	it("returns false for empty template", () => {
		expect(templateHasEditableContent("")).toBe(false);
	});

	it("returns false for plain text without placeholders", () => {
		expect(templateHasEditableContent("Hello world")).toBe(false);
	});

	it("returns true when content placeholder is among other placeholders", () => {
		expect(templateHasEditableContent("<h1>{{title}}</h1><div>{{content}}</div>")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// findFirstPipe
// ---------------------------------------------------------------------------

describe("findFirstPipe", () => {
	it("finds pipe in simple string", () => {
		expect(findFirstPipe("value | upper")).toBe(6);
	});

	it("returns -1 when no pipe exists", () => {
		expect(findFirstPipe("no pipe here")).toBe(-1);
	});

	it("ignores pipe inside double quotes", () => {
		expect(findFirstPipe('"a | b" | upper')).toBe(8);
	});

	it("ignores pipe inside single quotes", () => {
		expect(findFirstPipe("'a | b' | lower")).toBe(8);
	});

	it("returns -1 when all pipes are inside quotes", () => {
		expect(findFirstPipe('"a | b | c"')).toBe(-1);
	});

	it("handles empty string", () => {
		expect(findFirstPipe("")).toBe(-1);
	});

	it("handles pipe at the start", () => {
		expect(findFirstPipe("| upper")).toBe(0);
	});

	it("handles multiple pipes, returns first", () => {
		expect(findFirstPipe("a | b | c")).toBe(2);
	});

	it("handles mixed quoting", () => {
		expect(findFirstPipe(`"a | b" 'c | d' | filter`)).toBe(16);
	});
});

// ---------------------------------------------------------------------------
// resultToString
// ---------------------------------------------------------------------------

describe("resultToString", () => {
	it("returns empty string for null", () => {
		expect(resultToString(null)).toBe("");
	});

	it("returns empty string for undefined", () => {
		expect(resultToString(undefined)).toBe("");
	});

	it("passes strings through unchanged", () => {
		expect(resultToString("hello")).toBe("hello");
	});

	it("converts numbers to strings", () => {
		expect(resultToString(42)).toBe("42");
		expect(resultToString(3.14)).toBe("3.14");
	});

	it("converts booleans to strings", () => {
		expect(resultToString(true)).toBe("true");
		expect(resultToString(false)).toBe("false");
	});

	it("joins array of strings with comma-space", () => {
		expect(resultToString(["a", "b", "c"])).toBe("a, b, c");
	});

	it("handles array with null/undefined elements", () => {
		expect(resultToString(["a", null, "c"])).toBe("a, , c");
	});

	it("JSON-stringifies objects in arrays", () => {
		expect(resultToString([{ key: "val" }])).toBe('{"key":"val"}');
	});

	it("JSON-stringifies plain objects", () => {
		expect(resultToString({ a: 1 })).toBe('{"a":1}');
	});

	it("handles empty array", () => {
		expect(resultToString([])).toBe("");
	});

	it("handles empty string", () => {
		expect(resultToString("")).toBe("");
	});

	it("converts zero to string", () => {
		expect(resultToString(0)).toBe("0");
	});
});

// ---------------------------------------------------------------------------
// parsePropertyPath
// ---------------------------------------------------------------------------

describe("parsePropertyPath", () => {
	it("parses simple key", () => {
		expect(parsePropertyPath("title")).toEqual([{ key: "title" }]);
	});

	it("parses dotted path", () => {
		expect(parsePropertyPath("file.name")).toEqual([
			{ key: "file" },
			{ key: "name" },
		]);
	});

	it("parses key with array index", () => {
		expect(parsePropertyPath("cast[0]")).toEqual([
			{ key: "cast", index: 0 },
		]);
	});

	it("parses multi-segment with indices", () => {
		expect(parsePropertyPath("cast[0].cover[1]")).toEqual([
			{ key: "cast", index: 0 },
			{ key: "cover", index: 1 },
		]);
	});

	it("handles keys with hyphens", () => {
		expect(parsePropertyPath("my-prop")).toEqual([{ key: "my-prop" }]);
	});

	it("handles keys with underscores", () => {
		expect(parsePropertyPath("my_prop")).toEqual([{ key: "my_prop" }]);
	});

	it("returns empty array for empty string", () => {
		expect(parsePropertyPath("")).toEqual([]);
	});

	it("handles multi-digit index", () => {
		expect(parsePropertyPath("items[123]")).toEqual([
			{ key: "items", index: 123 },
		]);
	});

	it("handles three-level path", () => {
		expect(parsePropertyPath("a.b.c")).toEqual([
			{ key: "a" },
			{ key: "b" },
			{ key: "c" },
		]);
	});
});

// ---------------------------------------------------------------------------
// extractWikiLink
// ---------------------------------------------------------------------------

describe("extractWikiLink", () => {
	it("extracts simple wiki-link target", () => {
		expect(extractWikiLink("[[My Note]]")).toBe("My Note");
	});

	it("extracts link with path", () => {
		expect(extractWikiLink("[[folder/My Note]]")).toBe("folder/My Note");
	});

	it("extracts link target, ignoring display alias", () => {
		expect(extractWikiLink("[[My Note|Display Text]]")).toBe("My Note");
	});

	it("returns null for plain text", () => {
		expect(extractWikiLink("just text")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(extractWikiLink("")).toBeNull();
	});

	it("returns null for partial wiki-link syntax", () => {
		expect(extractWikiLink("[[incomplete")).toBeNull();
	});

	it("trims whitespace around the link", () => {
		expect(extractWikiLink("  [[Padded]]  ")).toBe("Padded");
	});

	it("handles link target with spaces", () => {
		expect(extractWikiLink("[[A Silent Voice]]")).toBe("A Silent Voice");
	});

	it("returns null for non-string input", () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(extractWikiLink(42 as any)).toBeNull();
	});

	it("returns null for nested brackets", () => {
		expect(extractWikiLink("[[a]] [[b]]")).toBeNull();
	});
});
