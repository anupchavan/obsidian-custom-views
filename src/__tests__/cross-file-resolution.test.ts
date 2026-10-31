/**
 * Tests for cross-file property resolution in renderer.ts
 *
 * Covers:
 *   - resolvePropertyChain — resolving property chains across files (async)
 *
 * Run with:  npm test
 */

import { describe, it, expect, vi } from "vitest";
import { parsePropertyPath, resolvePropertyChain } from "../renderer";
import type { App, TFile } from "obsidian";

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

	it.each([
		["title", "", "The White Tiger"],
		["tags[0]", "", "drama"],
		["tags[1]", "", "thriller"],
		["rating", "", 8.5],
		["basename", "", "The White Tiger"],
		["name", "", "The White Tiger.md"],
		["content", "Body text here", "Body text here"],
		["cast[0].cover[0]", "", "https://example.com/adarsh-cover.png"],
		["cast[0].cover[1]", "", "https://example.com/adarsh-alt.png"],
		["cast[0].born", "", "1994-01-01"],
		["director[0].nationality", "", "American"],
		["cast[0].cover", "", ["https://example.com/adarsh-cover.png", "https://example.com/adarsh-alt.png"]],
		["cast[0].basename", "", "Adarsh Gourav"],
		["cast[0].name", "", "Adarsh Gourav.md"],
		["cast[0].content", "", "Actor biography content here"],
		["director[0].content", "", "Director bio here"],
		["cast[0].puchi.content", "", "secret"],
		["cast[0].puchi.tags[0]", "", "secret-tag"],
		["cast[0].puchi.basename", "", "test 2"],
		["cast[0].puchi.ref.nationality", "", "American"],
		["cast[0].puchi.ref.cover[0]", "", "https://example.com/fincher.png"],
		["cast[0].nonexistent", "", null],
		["cast[99]", "", null],
		["tags[0].something", "", null],
		["title[0]", "", null],
		["", "", null],
	] as const)("resolves %j (body %j) to %j", async (path, body, expected) => {
		expect(await resolvePropertyChain(app, parsePropertyPath(path), movieFile, movieFrontmatter, body)).toEqual(expected);
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

	it("returns null when non-wiki-link breaks a three-level chain", async () => {
		// cast[0].aliases[0] is "AG" (not a wiki-link), so .something fails
		const segments = parsePropertyPath("cast[0].aliases[0].something");
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


describe("legacy placeholder property ownership", () => {
	it.each(["constructor", "toString", "__proto__", "nested.constructor", "nested.__proto__", "items.constructor"])("treats inherited property %s as missing", async path => {
		const file = createMockFile("Test", "Test.md");
		expect(await resolvePropertyChain(createMockApp([]), parsePropertyPath(path), file, { nested: {}, items: [] }, "")).toBe(null);
	});
	it.each(["constructor", "toString", "__proto__"])("preserves own properties named %s at the root and in nested data", async name => {
		const file = createMockFile("Test", "Test.md");
		const frontmatter = JSON.parse(`{"${name}":"Root value","nested":{"${name}":"Nested value"}}`) as Record<string, unknown>;
		expect(await resolvePropertyChain(createMockApp([]), parsePropertyPath(name), file, frontmatter, "")).toBe("Root value");
		expect(await resolvePropertyChain(createMockApp([]), parsePropertyPath(`nested.${name}`), file, frontmatter, "")).toBe("Nested value");
	});
	it("applies the same missing-property semantics after following a linked note", async () => {
		const file = createMockFile("Test", "Test.md"); const linked = createMockFile("Linked", "Linked.md");
		const app = createMockApp([{ file: linked, frontmatter: {}, rawContent: "Body" }]);
		expect(await resolvePropertyChain(app, parsePropertyPath("reference.constructor"), file, { reference: "[[Linked]]" }, "")).toBe(null);
	});
});
