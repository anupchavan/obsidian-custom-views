/**
 * Tests for cross-file property resolution in renderer.ts
 *
 * Covers:
 *   - parsePropertyPath — parsing dotted property chains with bracket indices
 *   - extractWikiLink — extracting link targets from [[wiki-link]] strings
 *   - resolvePropertyChain — resolving property chains across files (async)
 *
 * Run with:  npm test
 */

import { describe, it, expect, vi } from "vitest";
import {
	parsePropertyPath,
	extractWikiLink,
	resolvePropertyChain,
} from "../renderer";
import type { App, TFile } from "obsidian";

// ---------------------------------------------------------------------------
// parsePropertyPath
// ---------------------------------------------------------------------------

describe("parsePropertyPath", () => {
	it("parses a simple property name", () => {
		expect(parsePropertyPath("title")).toEqual([{ key: "title" }]);
	});

	it("parses a property with an array index", () => {
		expect(parsePropertyPath("cast[0]")).toEqual([
			{ key: "cast", index: 0 },
		]);
	});

	it("parses a multi-segment chain without indices", () => {
		expect(parsePropertyPath("cast.cover")).toEqual([
			{ key: "cast" },
			{ key: "cover" },
		]);
	});

	it("parses a multi-segment chain with indices", () => {
		expect(parsePropertyPath("cast[0].cover[1]")).toEqual([
			{ key: "cast", index: 0 },
			{ key: "cover", index: 1 },
		]);
	});

	it("parses a chain with only first segment indexed", () => {
		expect(parsePropertyPath("cast[0].cover")).toEqual([
			{ key: "cast", index: 0 },
			{ key: "cover" },
		]);
	});

	it("parses a chain with only last segment indexed", () => {
		expect(parsePropertyPath("cast.cover[2]")).toEqual([
			{ key: "cast" },
			{ key: "cover", index: 2 },
		]);
	});

	it("parses a three-segment chain", () => {
		expect(parsePropertyPath("cast[0].director[0].name")).toEqual([
			{ key: "cast", index: 0 },
			{ key: "director", index: 0 },
			{ key: "name" },
		]);
	});

	it("handles hyphenated property names", () => {
		expect(parsePropertyPath("cover-image[0]")).toEqual([
			{ key: "cover-image", index: 0 },
		]);
	});

	it("returns empty array for empty string", () => {
		expect(parsePropertyPath("")).toEqual([]);
	});

	it("parses a four-segment chain", () => {
		expect(parsePropertyPath("a[0].b[1].c[2].d")).toEqual([
			{ key: "a", index: 0 },
			{ key: "b", index: 1 },
			{ key: "c", index: 2 },
			{ key: "d" },
		]);
	});
});

// ---------------------------------------------------------------------------
// extractWikiLink
// ---------------------------------------------------------------------------

describe("extractWikiLink", () => {
	it("extracts a simple wiki-link", () => {
		expect(extractWikiLink("[[Adarsh Gourav]]")).toBe("Adarsh Gourav");
	});

	it("extracts a wiki-link with display alias", () => {
		expect(extractWikiLink("[[Adarsh Gourav|Actor Name]]")).toBe(
			"Adarsh Gourav"
		);
	});

	it("extracts a wiki-link with folder path", () => {
		expect(extractWikiLink("[[People/Adarsh Gourav]]")).toBe(
			"People/Adarsh Gourav"
		);
	});

	it("returns null for non-wiki-link strings", () => {
		expect(extractWikiLink("Adarsh Gourav")).toBeNull();
		expect(extractWikiLink("https://example.com")).toBeNull();
		expect(extractWikiLink("")).toBeNull();
	});

	it("returns null for partial wiki-link syntax", () => {
		expect(extractWikiLink("[[Adarsh Gourav")).toBeNull();
		expect(extractWikiLink("Adarsh Gourav]]")).toBeNull();
	});

	it("handles whitespace around the link", () => {
		expect(extractWikiLink("  [[Adarsh Gourav]]  ")).toBe("Adarsh Gourav");
	});

	it("returns null for non-string inputs", () => {
		expect(extractWikiLink(42 as unknown as string)).toBeNull();
		expect(extractWikiLink(null as unknown as string)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// resolvePropertyChain — mock helpers
// ---------------------------------------------------------------------------

interface MockFileEntry {
	file: TFile;
	frontmatter: Record<string, unknown>;
	/** Raw file content (including frontmatter) for cachedRead */
	rawContent: string;
}

function createMockFile(
	basename: string,
	path: string,
	stat?: Partial<{ size: number; ctime: number; mtime: number }>
): TFile {
	return {
		name: `${basename}.md`,
		basename,
		path,
		stat: {
			size: stat?.size ?? 1000,
			ctime: stat?.ctime ?? 1700000000000,
			mtime: stat?.mtime ?? 1700000000000,
		},
		vault: {} as unknown,
		parent: null,
		extension: "md",
	// eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast -- test mock
	} as unknown as TFile;
}

/**
 * Compute the byte offset of the end of the YAML frontmatter block
 * (the closing `---\n`) so the resolver can strip it from rawContent.
 */
function computeFrontmatterEndOffset(rawContent: string): number | undefined {
	if (!rawContent.startsWith("---")) return undefined;
	const closingIndex = rawContent.indexOf("\n---\n", 3);
	if (closingIndex === -1) return undefined;
	// offset is right after the closing "---\n"
	return closingIndex + 4 + 1; // +4 for "\n---", +1 for trailing "\n" // actually "\n---\n" is 5 chars
}

function createMockApp(files: MockFileEntry[]): App {
	const fileMap = new Map<string, MockFileEntry>();
	for (const entry of files) {
		fileMap.set(entry.file.basename, entry);
		fileMap.set(entry.file.path, entry);
	}

	return {
		metadataCache: {
			getFirstLinkpathDest: vi.fn(
				(linkTarget: string, _sourcePath: string) => {
					const entry = fileMap.get(linkTarget);
					return entry?.file ?? null;
				}
			),
			getFileCache: vi.fn((file: TFile) => {
				const entry = fileMap.get(file.basename);
				if (!entry) return null;
				// Include position.end.offset so the resolver can strip
				// frontmatter from rawContent
				const endOffset = computeFrontmatterEndOffset(entry.rawContent);
				const fm = endOffset !== undefined
					? { ...entry.frontmatter, position: { end: { offset: endOffset } } }
					: entry.frontmatter;
				return { frontmatter: fm };
			}),
		},
		vault: {
			cachedRead: vi.fn(async (file: TFile) => {
				const entry = fileMap.get(file.basename);
				return entry?.rawContent ?? "";
			}),
		},
	} as unknown as App;
}

// ---------------------------------------------------------------------------
// resolvePropertyChain
// ---------------------------------------------------------------------------

describe("resolvePropertyChain", () => {
	// ---- File setup ----

	const actorFile = createMockFile("Adarsh Gourav", "People/Adarsh Gourav.md");
	const actorFrontmatter = {
		cover: [
			"https://example.com/adarsh-cover.png",
			"https://example.com/adarsh-alt.png",
		],
		born: "1994-01-01",
		aliases: ["AG"],
		puchi: "[[test 2]]",
	};
	const actorRawContent = [
		"---",
		"cover:",
		"  - https://example.com/adarsh-cover.png",
		"  - https://example.com/adarsh-alt.png",
		"born: 1994-01-01",
		"aliases: [AG]",
		'puchi: "[[test 2]]"',
		"---",
		"Actor biography content here",
	].join("\n");

	const test2File = createMockFile("test 2", "test 2.md");
	const test2Frontmatter = {
		tags: ["secret-tag"],
		ref: "[[David Fincher]]",
	};
	const test2RawContent = [
		"---",
		"tags: [secret-tag]",
		'ref: "[[David Fincher]]"',
		"---",
		"secret",
	].join("\n");

	const directorFile = createMockFile("David Fincher", "People/David Fincher.md");
	const directorFrontmatter = {
		cover: ["https://example.com/fincher.png"],
		nationality: "American",
	};
	const directorRawContent = [
		"---",
		"cover:",
		"  - https://example.com/fincher.png",
		"nationality: American",
		"---",
		"Director bio here",
	].join("\n");

	const movieFile = createMockFile("The White Tiger", "Movies/The White Tiger.md");
	const movieFrontmatter = {
		cast: ["[[Adarsh Gourav]]", "[[Someone Else]]"],
		director: ["[[David Fincher]]"],
		title: "The White Tiger",
		rating: 8.5,
		tags: ["drama", "thriller"],
	};

	const app = createMockApp([
		{ file: actorFile, frontmatter: actorFrontmatter, rawContent: actorRawContent },
		{ file: test2File, frontmatter: test2Frontmatter, rawContent: test2RawContent },
		{ file: directorFile, frontmatter: directorFrontmatter, rawContent: directorRawContent },
		{ file: movieFile, frontmatter: movieFrontmatter, rawContent: "" },
	]);

	// ---- Basic single-level tests ----

	it("resolves a simple frontmatter property", async () => {
		const segments = parsePropertyPath("title");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("The White Tiger");
	});

	it("resolves a simple array with index", async () => {
		const segments = parsePropertyPath("tags[0]");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("drama");
	});

	it("resolves a simple array with second index", async () => {
		const segments = parsePropertyPath("tags[1]");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("thriller");
	});

	it("resolves a numeric frontmatter value", async () => {
		const segments = parsePropertyPath("rating");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe(8.5);
	});

	it("resolves built-in file properties: basename", async () => {
		const segments = parsePropertyPath("basename");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("The White Tiger");
	});

	it("resolves built-in file properties: name", async () => {
		const segments = parsePropertyPath("name");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("The White Tiger.md");
	});

	it("resolves content from body", async () => {
		const segments = parsePropertyPath("content");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, "Body text here"
		);
		expect(result).toBe("Body text here");
	});

	// ---- Two-level cross-file tests ----

	it("resolves cast[0].cover[0]", async () => {
		const segments = parsePropertyPath("cast[0].cover[0]");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("https://example.com/adarsh-cover.png");
	});

	it("resolves cast[0].cover[1]", async () => {
		const segments = parsePropertyPath("cast[0].cover[1]");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("https://example.com/adarsh-alt.png");
	});

	it("resolves cast[0].born", async () => {
		const segments = parsePropertyPath("cast[0].born");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("1994-01-01");
	});

	it("resolves director[0].nationality", async () => {
		const segments = parsePropertyPath("director[0].nationality");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("American");
	});

	it("resolves cast[0].cover (full array)", async () => {
		const segments = parsePropertyPath("cast[0].cover");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toEqual([
			"https://example.com/adarsh-cover.png",
			"https://example.com/adarsh-alt.png",
		]);
	});

	// ---- Cross-file built-in file properties ----

	it("resolves cast[0].basename (linked file built-in)", async () => {
		const segments = parsePropertyPath("cast[0].basename");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("Adarsh Gourav");
	});

	it("resolves cast[0].name (linked file built-in)", async () => {
		const segments = parsePropertyPath("cast[0].name");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("Adarsh Gourav.md");
	});

	it("resolves cast[0].content (linked file body content)", async () => {
		const segments = parsePropertyPath("cast[0].content");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("Actor biography content here");
	});

	it("resolves director[0].content (linked file body content)", async () => {
		const segments = parsePropertyPath("director[0].content");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("Director bio here");
	});

	// ---- Three-level cross-file tests ----

	it("resolves cast[0].puchi.content (3-level chain, body of 3rd file)", async () => {
		const segments = parsePropertyPath("cast[0].puchi.content");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("secret");
	});

	it("resolves cast[0].puchi.tags[0] (3-level chain, frontmatter of 3rd file)", async () => {
		const segments = parsePropertyPath("cast[0].puchi.tags[0]");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("secret-tag");
	});

	it("resolves cast[0].puchi.basename (3-level chain, built-in of 3rd file)", async () => {
		const segments = parsePropertyPath("cast[0].puchi.basename");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("test 2");
	});

	// ---- Four-level cross-file test ----

	it("resolves cast[0].puchi.ref.nationality (4-level chain)", async () => {
		const segments = parsePropertyPath("cast[0].puchi.ref.nationality");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("American");
	});

	it("resolves cast[0].puchi.ref.cover[0] (4-level chain with final index)", async () => {
		const segments = parsePropertyPath("cast[0].puchi.ref.cover[0]");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBe("https://example.com/fincher.png");
	});

	// ---- Error / edge cases ----

	it("returns null for a missing property in linked file", async () => {
		const segments = parsePropertyPath("cast[0].nonexistent");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBeNull();
	});

	it("returns null for out-of-bounds array index", async () => {
		const segments = parsePropertyPath("cast[99]");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBeNull();
	});

	it("returns null for non-wiki-link value in chain", async () => {
		const segments = parsePropertyPath("tags[0].something");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBeNull();
	});

	it("returns null when linked file doesn't exist", async () => {
		const frontmatter = {
			cast: ["[[NonExistent Person]]"],
		};
		const segments = parsePropertyPath("cast[0].cover");
		const result = await resolvePropertyChain(
			app, segments, movieFile, frontmatter, ""
		);
		expect(result).toBeNull();
	});

	it("returns null for indexing a non-array value", async () => {
		const segments = parsePropertyPath("title[0]");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBeNull();
	});

	it("returns null when non-wiki-link breaks a three-level chain", async () => {
		// cast[0].aliases[0] is "AG" (not a wiki-link), so .something fails
		const segments = parsePropertyPath("cast[0].aliases[0].something");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBeNull();
	});

	it("returns null for empty segments", async () => {
		const segments = parsePropertyPath("");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBeNull();
	});

	it("returns null when mid-chain file has no frontmatter for next key", async () => {
		// cast[0].puchi resolves to test2, test2 has no "nonexistent" property
		const segments = parsePropertyPath("cast[0].puchi.nonexistent");
		const result = await resolvePropertyChain(
			app, segments, movieFile, movieFrontmatter, ""
		);
		expect(result).toBeNull();
	});
});
