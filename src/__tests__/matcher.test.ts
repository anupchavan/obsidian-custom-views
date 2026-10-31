/**
 * Tests for src/matcher.ts — checkRules (the heart of the plugin's filtering logic).
 *
 * All Obsidian APIs are mocked via __mocks__/obsidian.ts and the factory helpers below.
 * Tests cover:
 *   - AND / OR / NOR group logic (including nesting)
 *   - Every file field (file.name, file.basename, file.path, file.folder,
 *     file.size, file.extension, file.ctime, file.mtime)
 *   - All scalar operators (is, is not, contains, does not contain, starts with,
 *     ends with, is empty, is not empty, contains any of, does not contain any of,
 *     contains all of, does not contain all of)
 *   - Array frontmatter fields
 *   - Special "file" field operators: in folder, is not in folder, has tag,
 *     does not have tag, has property, does not have property
 *   - Date operators on file.ctime / file.mtime
 */

import { describe, it, expect, vi } from "vitest";
import { checkRules } from "../matcher";
import { folder } from "./folder";
import type { TFolder } from "obsidian";
import type { FilterGroup, Filter } from "../types";

// ---------------------------------------------------------------------------
// Mock builder helpers
// ---------------------------------------------------------------------------

interface MockFileOptions {
	name?: string;
	basename?: string;
	path?: string;
	extension?: string;
	stat?: { ctime: number; mtime: number; size: number };
	parent?: TFolder | null;
}

function mockFile(opts: MockFileOptions = {}) {
	return {
		name: opts.name ?? "note.md",
		basename: opts.basename ?? "note",
		path: opts.path ?? "note.md",
		extension: opts.extension ?? "md",
		stat: opts.stat ?? { ctime: 0, mtime: 0, size: 100 },
		parent: opts.parent !== undefined ? opts.parent : { path: "" },
	} as unknown as import("obsidian").TFile;
}

interface MockAppOptions {
	/** Tags returned by getFileCache(file).tags */
	bodyTags?: Array<{ tag: string }>;
	/** Links returned by getFileCache(file).links */
	bodyLinks?: Array<{ link: string }>;
	/** Resolved file returned by getFirstLinkpathDest */
	linkDest?: { path: string } | null;
	/**
	 * Map of linkpath → resolved file path for getFirstLinkpathDest.
	 * Takes precedence over linkDest if provided.
	 * This enables proper "links to" testing where filter value and body links
	 * need to resolve to different (or same) target files.
	 */
	linkDestMap?: Record<string, { path: string } | null>;
	/** Frontmatter returned by getFileCache(file).frontmatter (for link extraction in matcher) */
	cacheFrontmatter?: Record<string, unknown>;
}

function mockApp(opts: MockAppOptions = {}) {
	return {
		metadataCache: {
			getFileCache: () => ({
				tags: opts.bodyTags ?? [],
				links: opts.bodyLinks ?? [],
				frontmatter: opts.cacheFrontmatter ?? undefined,
			}),
			getFirstLinkpathDest: (linkpath: string, _sourcePath: string) => {
				if (opts.linkDestMap) {
					return linkpath in opts.linkDestMap ? opts.linkDestMap[linkpath] : null;
				}
				return opts.linkDest ?? null;
			},
		},
	} as unknown as import("obsidian").App;
}

// ---------------------------------------------------------------------------
// Helpers to build filter groups concisely
// ---------------------------------------------------------------------------

function andGroup(...conditions: (Filter | FilterGroup)[]): FilterGroup {
	return { type: "group", operator: "AND", conditions };
}

function orGroup(...conditions: (Filter | FilterGroup)[]): FilterGroup {
	return { type: "group", operator: "OR", conditions };
}

function norGroup(...conditions: (Filter | FilterGroup)[]): FilterGroup {
	return { type: "group", operator: "NOR", conditions };
}

function filter(field: string, operator: Filter["operator"], value?: string): Filter {
	return { type: "filter", field, operator, value };
}

it("skips later metadata lookups after a group's result is known", () => {
	const app = mockApp();
	const read = vi.spyOn(app.metadataCache, "getFileCache");
	const file = mockFile();
	const expensive = filter("file.tags", "contains", "books");
	expect(checkRules(app, andGroup(filter("file.name", "is", "other.md"), expensive), file)).toBe(false);
	expect(checkRules(app, orGroup(filter("file.name", "is", "note.md"), expensive), file)).toBe(true);
	expect(checkRules(app, norGroup(filter("file.name", "is", "note.md"), expensive), file)).toBe(false);
	expect(read).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Empty group
// ---------------------------------------------------------------------------

describe("empty conditions group", () => {
	it("always returns true when there are no conditions", () => {
		const group = andGroup();
		expect(checkRules(mockApp(), group, mockFile())).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AND / OR / NOR group logic
// ---------------------------------------------------------------------------

describe("AND group", () => {
	it("returns true when ALL conditions are true", () => {
		const group = andGroup(
			filter("file.basename", "is", "note"),
			filter("file.extension", "is", "md")
		);
		expect(checkRules(mockApp(), group, mockFile())).toBe(true);
	});

	it("returns false when ANY condition is false", () => {
		const group = andGroup(
			filter("file.basename", "is", "note"),
			filter("file.extension", "is", "txt") // wrong extension
		);
		expect(checkRules(mockApp(), group, mockFile())).toBe(false);
	});
});

describe("OR group", () => {
	it("returns true when at least one condition is true", () => {
		const group = orGroup(
			filter("file.basename", "is", "wrong"),
			filter("file.extension", "is", "md") // this one is true
		);
		expect(checkRules(mockApp(), group, mockFile())).toBe(true);
	});

	it("returns false when ALL conditions are false", () => {
		const group = orGroup(
			filter("file.basename", "is", "wrong"),
			filter("file.extension", "is", "txt")
		);
		expect(checkRules(mockApp(), group, mockFile())).toBe(false);
	});
});

describe("NOR group", () => {
	it("returns true when ALL conditions are false", () => {
		const group = norGroup(
			filter("file.basename", "is", "wrong"),
			filter("file.extension", "is", "txt")
		);
		expect(checkRules(mockApp(), group, mockFile())).toBe(true);
	});

	it("returns false when ANY condition is true", () => {
		const group = norGroup(
			filter("file.basename", "is", "wrong"),
			filter("file.extension", "is", "md") // this one is true
		);
		expect(checkRules(mockApp(), group, mockFile())).toBe(false);
	});
});

describe("nested groups", () => {
	it("evaluates nested groups recursively", () => {
		// (name is 'note' AND extension is 'md') OR (basename is 'other')
		const group = orGroup(
			andGroup(
				filter("file.basename", "is", "note"),
				filter("file.extension", "is", "md")
			),
			filter("file.basename", "is", "other")
		);
		expect(checkRules(mockApp(), group, mockFile())).toBe(true);
	});

	it("returns false when all nested groups fail", () => {
		const group = andGroup(
			orGroup(
				filter("file.basename", "is", "wrong1"),
				filter("file.basename", "is", "wrong2")
			),
			filter("file.extension", "is", "md")
		);
		expect(checkRules(mockApp(), group, mockFile())).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// file.* scalar fields
// ---------------------------------------------------------------------------

describe("file.name", () => {
	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["file.name", "is", "note.md", true],
		["file.name", "is not", "other.md", true],
		["file.name", "contains", "note", true],
		["file.name", "does not contain", "xyz", true],
		["file.name", "starts with", "note", true],
		["file.name", "ends with", ".md", true],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(mockApp(), andGroup(filter(field, operator, value)), mockFile())).toBe(expected);
	});
});

describe("file.basename", () => {
	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["file.basename", "is", "note", true],
		["file.basename", "is not", "note", false],
		["file.basename", "is empty", undefined, false],
		["file.basename", "is not empty", undefined, true],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(mockApp(), andGroup(filter(field, operator, value)), mockFile())).toBe(expected);
	});

	it("is empty — true when basename is empty string", () => {
		expect(checkRules(mockApp(), andGroup(filter("file.basename", "is empty")), mockFile({ basename: "" }))).toBe(true);
	});
});

describe("file.path", () => {
	const file = mockFile({ path: "folder/sub/note.md" });
	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["file.path", "starts with", "folder", true],
		["file.path", "ends with", "note.md", true],
		["file.path", "contains", "sub", true],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(mockApp(), andGroup(filter(field, operator, value)), file)).toBe(expected);
	});
});

describe("file.extension", () => {
	it("is md", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.extension", "is", "md")), mockFile())).toBe(true));
	it("is not pdf", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.extension", "is not", "pdf")), mockFile())).toBe(true));
});

describe("file.size", () => {
	const file = mockFile({ stat: { ctime: 0, mtime: 0, size: 500 } });
	it("is — numeric comparison as string", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.size", "is", "500")), file)).toBe(true));
	it("is not", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.size", "is not", "999")), file)).toBe(true));
});

describe("file.folder", () => {
	const file = mockFile({ parent: folder("projects/work") });
	it("is empty for a note at the vault root", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.folder", "is", "")), mockFile({ parent: folder("/") }))).toBe(true));
	it("contains the folder name", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.folder", "contains", "work")), file)).toBe(true));
	it("does not contain an unrelated string", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.folder", "does not contain", "personal")), file)).toBe(true));
});

// ---------------------------------------------------------------------------
// file field — in folder / is not in folder
// ---------------------------------------------------------------------------

describe("in folder / is not in folder", () => {
	it("matches file directly in target folder", () => {
		const file = mockFile({ parent: folder("work") });
		expect(checkRules(mockApp(), andGroup(filter("file", "in folder", "work")), file)).toBe(true);
	});

	it("matches file in a sub-folder of target", () => {
		const file = mockFile({ parent: folder("work/projects") });
		expect(checkRules(mockApp(), andGroup(filter("file", "in folder", "work")), file)).toBe(true);
	});

	it("does not match file in a different folder", () => {
		const file = mockFile({ parent: folder("personal") });
		expect(checkRules(mockApp(), andGroup(filter("file", "in folder", "work")), file)).toBe(false);
	});

	it("is not in folder — true when file is elsewhere", () => {
		const file = mockFile({ parent: folder("personal") });
		expect(checkRules(mockApp(), andGroup(filter("file", "is not in folder", "work")), file)).toBe(true);
	});

	it("is not in folder — false when file is there", () => {
		const file = mockFile({ parent: folder("work") });
		expect(checkRules(mockApp(), andGroup(filter("file", "is not in folder", "work")), file)).toBe(false);
	});

	it("handles leading/trailing slashes on folder value", () => {
		const file = mockFile({ parent: folder("work") });
		expect(checkRules(mockApp(), andGroup(filter("file", "in folder", "/work/")), file)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// file field — has tag / does not have tag
// ---------------------------------------------------------------------------

describe("has tag / does not have tag", () => {
	it("matches a body tag (exact)", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file", "has tag", "movies")), mockFile())).toBe(true);
	});

	it("matches a parent tag (fileTag is 'movies/action', filter is 'movies')", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies/action" }] });
		expect(checkRules(app, andGroup(filter("file", "has tag", "movies")), mockFile())).toBe(true);
	});

	it("does not invent a child tag when the note only has the parent", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file", "has tag", "movies/action")), mockFile())).toBe(false);
		expect(checkRules(app, andGroup(filter("file", "does not have tag", "movies/action")), mockFile())).toBe(true);
	});

	it.each([
		["#Movies/Action", "#movies", true],
		["#movies/action", " MOVIES/Action ", true],
		["#moviesarchive", "movies", false],
		["#movies/action", "movies/comedy", false],
	])("matches %s against %s with native Bases tag semantics", (tag, value, expected) => {
		const app = mockApp({ bodyTags: [{ tag }] });
		expect(checkRules(app, andGroup(filter("file", "has tag", value)), mockFile())).toBe(expected);
		expect(checkRules(app, andGroup(filter("file", "does not have tag", value)), mockFile())).toBe(!expected);
	});

	it("matches a frontmatter tag (array)", () => {
		const app = mockApp({ bodyTags: [] });
		const fm = { tags: ["recipe", "cooking"] };
		expect(checkRules(app, andGroup(filter("file", "has tag", "recipe")), mockFile(), fm)).toBe(true);
	});

	it("matches a frontmatter tag (single string)", () => {
		const app = mockApp({ bodyTags: [] });
		const fm = { tags: "recipe" };
		expect(checkRules(app, andGroup(filter("file", "has tag", "recipe")), mockFile(), fm)).toBe(true);
	});

	it("does not match when tag is absent", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file", "has tag", "books")), mockFile())).toBe(false);
	});

	it("does not have tag — true when tag is absent", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file", "does not have tag", "books")), mockFile())).toBe(true);
	});

	it("does not have tag — false when tag is present", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file", "does not have tag", "movies")), mockFile())).toBe(false);
	});

	it("accepts multiple comma-separated tags (OR logic)", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file", "has tag", "books,movies")), mockFile())).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// file field — has property / does not have property
// ---------------------------------------------------------------------------

describe("has property / does not have property", () => {
	it.each(["constructor", "toString", "__proto__"])("does not invent the inherited property %s", name => {
		expect(checkRules(mockApp(), andGroup(filter("file", "has property", name)), mockFile(), {})).toBe(false);
		expect(checkRules(mockApp(), andGroup(filter("file", "does not have property", name)), mockFile(), {})).toBe(true);
		expect(checkRules(mockApp(), andGroup(filter(name, "is empty")), mockFile(), {})).toBe(true);
	});

	it("recognizes real properties even when their names shadow object members", () => {
		const fm = { constructor: "custom" };
		expect(checkRules(mockApp(), andGroup(filter("file", "has property", "constructor")), mockFile(), fm)).toBe(true);
		expect(checkRules(mockApp(), andGroup(filter("constructor", "is", "custom")), mockFile(), fm)).toBe(true);
	});

	it("has property — true when property exists in frontmatter", () => {
		const fm = { status: "done" };
		expect(checkRules(mockApp(), andGroup(filter("file", "has property", "status")), mockFile(), fm)).toBe(true);
	});

	it("has property — false when property is missing", () => {
		const fm = { title: "My Note" };
		expect(checkRules(mockApp(), andGroup(filter("file", "has property", "status")), mockFile(), fm)).toBe(false);
	});

	it("does not have property — true when property is missing", () => {
		const fm = { title: "My Note" };
		expect(checkRules(mockApp(), andGroup(filter("file", "does not have property", "status")), mockFile(), fm)).toBe(true);
	});

	it("does not have property — false when property exists", () => {
		const fm = { status: "done" };
		expect(checkRules(mockApp(), andGroup(filter("file", "does not have property", "status")), mockFile(), fm)).toBe(false);
	});

	it("has property — false when no frontmatter at all", () => {
		expect(checkRules(mockApp(), andGroup(filter("file", "has property", "status")), mockFile())).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Frontmatter scalar fields
// ---------------------------------------------------------------------------

describe("frontmatter scalar field", () => {
	const fm = { status: "done", priority: 3, draft: false };

	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["status", "is", "done", true],
		["status", "is not", "pending", true],
		["status", "contains", "don", true],
		["status", "does not contain", "xyz", true],
		["status", "starts with", "do", true],
		["status", "ends with", "ne", true],
		["status", "is empty", undefined, false],
		["status", "is not empty", undefined, true],
		["missing_field", "is empty", undefined, true],
		["status", "contains any of", "pending,done", true],
		["status", "contains any of", "pending,archived", false],
		["status", "contains all of", "don,ne", true],
		["status", "contains all of", "done,xyz", false],
		["status", "does not contain any of", "pending,archived", true],
		["status", "does not contain all of", "done,xyz", true],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(mockApp(), andGroup(filter(field, operator, value)), mockFile(), fm)).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// Frontmatter array (list) fields
// ---------------------------------------------------------------------------

describe("frontmatter array field", () => {
	const fm = { categories: ["fiction", "thriller", "mystery"] };

	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["categories", "is", "thriller", true],
		["categories", "is", "biography", false],
		["categories", "is not", "biography", true],
		["categories", "contains", "rill", true],
		["categories", "does not contain", "rill", false],
		["categories", "is empty", undefined, false],
		["categories", "is not empty", undefined, true],
		["categories", "contains any of", "biography,fiction", true],
		["categories", "contains any of", "biography,horror", false],
		["categories", "contains all of", "fiction,thriller", true],
		["categories", "contains all of", "fiction,horror", false],
		["categories", "does not contain any of", "biography,horror", true],
		["categories", "does not contain all of", "fiction,horror", true],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(mockApp(), andGroup(filter(field, operator, value)), mockFile(), fm)).toBe(expected);
	});

	it("is empty — true for empty array", () => {
		const emptyFm = { categories: [] as string[] };
		expect(checkRules(mockApp(), andGroup(filter("categories", "is empty")), mockFile(), emptyFm)).toBe(true);
	});

});

// ---------------------------------------------------------------------------
// file.ctime / file.mtime date operators
// ---------------------------------------------------------------------------

describe("file.ctime date operators", () => {
	// A file created on 2024-06-15
	const createdDate = new Date("2024-06-15T12:00:00Z");
	const file = mockFile({ stat: { ctime: createdDate.getTime(), mtime: 0, size: 0 } });

	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["file.ctime", "on", "2024-06-15", true],
		["file.ctime", "on", "2024-06-14", false],
		["file.ctime", "not on", "2024-06-14", true],
		["file.ctime", "before", "2024-06-16", true],
		["file.ctime", "before", "2024-06-15", false],
		["file.ctime", "on or before", "2024-06-15", true],
		["file.ctime", "after", "2024-06-14", true],
		["file.ctime", "after", "2024-06-15", false],
		["file.ctime", "on or after", "2024-06-15", true],
		["file.ctime", "is not empty", undefined, true],
		["file.ctime", "is empty", undefined, false],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(mockApp(), andGroup(filter(field, operator, value)), file)).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// file tags field
// ---------------------------------------------------------------------------

describe("file tags field operators", () => {
	it("contains — true when tag present", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file tags", "contains", "movies")), mockFile())).toBe(true);
	});

	it("does not contain — true when tag absent", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file tags", "does not contain", "books")), mockFile())).toBe(true);
	});

	it("is — exact match on a tag element", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file tags", "is", "movies")), mockFile())).toBe(true);
	});

	it("is empty — true when no tags", () => {
		const app = mockApp({ bodyTags: [] });
		expect(checkRules(app, andGroup(filter("file tags", "is empty")), mockFile())).toBe(true);
	});

	it("is not empty — true when tags exist", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file tags", "is not empty")), mockFile())).toBe(true);
	});

	it("includes frontmatter tags in the list", () => {
		const app = mockApp({ bodyTags: [] });
		const fm = { tags: ["cooking"] };
		expect(checkRules(app, andGroup(filter("file tags", "contains", "cooking")), mockFile(), fm)).toBe(true);
	});

	it("contains any of — matches when any tag is found", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }, { tag: "#books" }] });
		expect(checkRules(app, andGroup(filter("file tags", "contains any of", "books,music")), mockFile())).toBe(true);
	});

	it("contains any of — false when no tags match", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file tags", "contains any of", "books,music")), mockFile())).toBe(false);
	});

	it("does not contain any of — true when no tags match", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file tags", "does not contain any of", "books,music")), mockFile())).toBe(true);
	});

	it("contains all of — true when all tags present", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }, { tag: "#books" }, { tag: "#music" }] });
		expect(checkRules(app, andGroup(filter("file tags", "contains all of", "movies,books")), mockFile())).toBe(true);
	});

	it("contains all of — false when not all tags present", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file tags", "contains all of", "movies,books")), mockFile())).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// file field — links to / does not link to
// ---------------------------------------------------------------------------

describe("links to / does not link to", () => {
	it("matches when file has a body link to the target", () => {
		const app = mockApp({
			bodyLinks: [{ link: "Science Fiction" }],
			linkDestMap: {
				"Science Fiction": { path: "Science Fiction.md" },
			}
		});
		expect(checkRules(app, andGroup(filter("file", "links to", "Science Fiction")), mockFile())).toBe(true);
	});

	it("resolves links that point at a heading", () => {
		const app = mockApp({
			bodyLinks: [{ link: "Science Fiction#Plot" }],
			linkDestMap: { "Science Fiction": { path: "Science Fiction.md" } },
		});
		expect(checkRules(app, andGroup(filter("file", "links to", "Science Fiction#Plot")), mockFile())).toBe(true);
	});

	it("does not match when file has no link to the target", () => {
		const app = mockApp({
			bodyLinks: [{ link: "Other Note" }],
			linkDestMap: {
				"Science Fiction": { path: "Science Fiction.md" },
				"Other Note": { path: "Other Note.md" },
			}
		});
		expect(checkRules(app, andGroup(filter("file", "links to", "Science Fiction")), mockFile())).toBe(false);
	});

	it("does not link to — true when file has no link to target", () => {
		const app = mockApp({
			bodyLinks: [{ link: "Other Note" }],
			linkDestMap: {
				"Science Fiction": { path: "Science Fiction.md" },
				"Other Note": { path: "Other Note.md" },
			}
		});
		expect(checkRules(app, andGroup(filter("file", "does not link to", "Science Fiction")), mockFile())).toBe(true);
	});

	it("does not link to — false when file links to target", () => {
		const app = mockApp({
			bodyLinks: [{ link: "Science Fiction" }],
			linkDestMap: {
				"Science Fiction": { path: "Science Fiction.md" },
			}
		});
		expect(checkRules(app, andGroup(filter("file", "does not link to", "Science Fiction")), mockFile())).toBe(false);
	});

	it("returns false for links to when filter value resolves to no file", () => {
		const app = mockApp({
			bodyLinks: [{ link: "Something" }],
			linkDestMap: {}  // nothing resolves
		});
		expect(checkRules(app, andGroup(filter("file", "links to", "NonExistent")), mockFile())).toBe(false);
	});

	it("returns true for does not link to when filter value resolves to no file", () => {
		const app = mockApp({
			bodyLinks: [],
			linkDestMap: {}
		});
		expect(checkRules(app, andGroup(filter("file", "does not link to", "NonExistent")), mockFile())).toBe(true);
	});

	it("matches frontmatter wikilinks", () => {
		const app = mockApp({
			bodyLinks: [],
			cacheFrontmatter: {
				categories: ["[[Science Fiction]]", "thriller"]
			},
			linkDestMap: {
				"Science Fiction": { path: "Science Fiction.md" },
			}
		});
		const fm = { categories: ["[[Science Fiction]]", "thriller"] };
		expect(checkRules(app, andGroup(filter("file", "links to", "Science Fiction")), mockFile(), fm)).toBe(true);
	});

	it("does not match frontmatter plain text as link", () => {
		const app = mockApp({
			bodyLinks: [],
			cacheFrontmatter: {
				categories: ["thriller"]  // no wikilink
			},
			linkDestMap: {
				"Science Fiction": { path: "Science Fiction.md" },
			}
		});
		const fm = { categories: ["thriller"] };
		expect(checkRules(app, andGroup(filter("file", "links to", "Science Fiction")), mockFile(), fm)).toBe(false);
	});

	it("matches file with path value (e.g. 'Music/Belinda Says')", () => {
		const app = mockApp({
			bodyLinks: [{ link: "Belinda Says" }],
			linkDestMap: {
				"Music/Belinda Says": { path: "Music/Belinda Says.md" },
				"Belinda Says": { path: "Music/Belinda Says.md" },
			}
		});
		expect(checkRules(app, andGroup(filter("file", "links to", "Music/Belinda Says")), mockFile())).toBe(true);
	});

	it("handles empty filter value — links to empty is false", () => {
		const app = mockApp({ bodyLinks: [], linkDestMap: {} });
		expect(checkRules(app, andGroup(filter("file", "links to", "")), mockFile())).toBe(false);
	});

	it("handles empty filter value — does not link to empty is true", () => {
		const app = mockApp({ bodyLinks: [], linkDestMap: {} });
		expect(checkRules(app, andGroup(filter("file", "does not link to", "")), mockFile())).toBe(true);
	});

	it("matches multiple links in body", () => {
		const app = mockApp({
			bodyLinks: [{ link: "Note A" }, { link: "Note B" }, { link: "Science Fiction" }],
			linkDestMap: {
				"Science Fiction": { path: "Science Fiction.md" },
				"Note A": { path: "Note A.md" },
				"Note B": { path: "Note B.md" },
			}
		});
		expect(checkRules(app, andGroup(filter("file", "links to", "Science Fiction")), mockFile())).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Frontmatter date fields (user-defined date/datetime properties)
// ---------------------------------------------------------------------------

describe("frontmatter date field operators", () => {
	it("on — matches exact date string", () => {
		const fm = { published: "2022-10-07" };
		expect(checkRules(mockApp(), andGroup(filter("published", "is", "2022-10-07")), mockFile(), fm)).toBe(true);
	});

	it("is not — does not match different date string", () => {
		const fm = { published: "2022-10-07" };
		expect(checkRules(mockApp(), andGroup(filter("published", "is not", "2022-01-01")), mockFile(), fm)).toBe(true);
	});

	it("is empty — true when date field is missing", () => {
		const fm = { title: "Test" };
		expect(checkRules(mockApp(), andGroup(filter("published", "is empty")), mockFile(), fm)).toBe(true);
	});

	it("is not empty — true when date field has value", () => {
		const fm = { published: "2022-10-07" };
		expect(checkRules(mockApp(), andGroup(filter("published", "is not empty")), mockFile(), fm)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Number comparison operators
// ---------------------------------------------------------------------------

describe("number operators (= ≠ < ≤ > ≥)", () => {
	const fm = { rating: 8 };

	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["rating", "is", "8", true],
		["rating", "is", "5", false],
		["rating", "is not", "5", true],
		["rating", "is empty", undefined, false],
		["rating", "is not empty", undefined, true],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(mockApp(), andGroup(filter(field, operator, value)), mockFile(), fm)).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// Boolean (checkbox) fields
// ---------------------------------------------------------------------------

describe("checkbox field", () => {
	it("is true — matches true value", () => {
		const fm = { completed: true };
		expect(checkRules(mockApp(), andGroup(filter("completed", "is", "true")), mockFile(), fm)).toBe(true);
	});

	it("is false — matches false value", () => {
		const fm = { completed: false };
		expect(checkRules(mockApp(), andGroup(filter("completed", "is", "false")), mockFile(), fm)).toBe(true);
	});

	it("is true — false when value is false", () => {
		const fm = { completed: false };
		expect(checkRules(mockApp(), andGroup(filter("completed", "is", "true")), mockFile(), fm)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Aliases field
// ---------------------------------------------------------------------------

describe("aliases field", () => {
	it("contains — matches an alias", () => {
		const app = mockApp();
		const fm = { aliases: ["My Alias", "Another Name"] };
		expect(checkRules(app, andGroup(filter("aliases", "contains", "My Alias")), mockFile(), fm)).toBe(true);
	});

	it("is empty — true when no aliases", () => {
		const app = mockApp();
		const fm = { aliases: [] as string[] };
		expect(checkRules(app, andGroup(filter("aliases", "is empty")), mockFile(), fm)).toBe(true);
	});

	it("is not empty — true when aliases exist", () => {
		const app = mockApp();
		const fm = { aliases: ["Alias1"] };
		expect(checkRules(app, andGroup(filter("aliases", "is not empty")), mockFile(), fm)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// file.mtime date operators
// ---------------------------------------------------------------------------

describe("file.mtime date operators", () => {
	const modifiedDate = new Date("2025-01-10T08:00:00Z");
	const file = mockFile({ stat: { ctime: 0, mtime: modifiedDate.getTime(), size: 0 } });

	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["file.mtime", "on", "2025-01-10", true],
		["file.mtime", "on", "2025-01-09", false],
		["file.mtime", "before", "2025-01-11", true],
		["file.mtime", "after", "2025-01-09", true],
		["file.mtime", "on or before", "2025-01-10", true],
		["file.mtime", "on or after", "2025-01-10", true],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(mockApp(), andGroup(filter(field, operator, value)), file)).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// Complex combined scenarios
// ---------------------------------------------------------------------------

describe("complex combined filters", () => {
	it("AND: file in folder AND has tag AND property value", () => {
		const app = mockApp({ bodyTags: [{ tag: "#fiction" }] });
		const file = mockFile({ parent: folder("Books") });
		const fm = { status: "published" };
		const group = andGroup(
			filter("file", "in folder", "Books"),
			filter("file", "has tag", "fiction"),
			filter("status", "is", "published")
		);
		expect(checkRules(app, group, file, fm)).toBe(true);
	});

	it("AND fails when one condition fails", () => {
		const app = mockApp({ bodyTags: [{ tag: "#fiction" }] });
		const file = mockFile({ parent: folder("Books") });
		const fm = { status: "draft" };
		const group = andGroup(
			filter("file", "in folder", "Books"),
			filter("file", "has tag", "fiction"),
			filter("status", "is", "published")  // fails
		);
		expect(checkRules(app, group, file, fm)).toBe(false);
	});

	it("OR: matches when at least one condition true", () => {
		const app = mockApp({ bodyTags: [] });
		const file = mockFile({ parent: folder("Music") });
		const fm = { genre: "rock" };
		const group = orGroup(
			filter("file", "has tag", "fiction"),    // false
			filter("file", "in folder", "Music"),    // true
			filter("genre", "is", "jazz")            // false
		);
		expect(checkRules(app, group, file, fm)).toBe(true);
	});

	it("NOR: true when all conditions are false", () => {
		const app = mockApp({ bodyTags: [] });
		const file = mockFile({ parent: folder("Music") });
		const fm = { status: "published" };
		const group = norGroup(
			filter("file", "has tag", "fiction"),           // false
			filter("file", "in folder", "Books"),           // false
			filter("status", "is", "draft")                 // false
		);
		expect(checkRules(app, group, file, fm)).toBe(true);
	});

	it("nested: (links to X OR in folder Y) AND has tag Z", () => {
		const app = mockApp({
			bodyTags: [{ tag: "#scifi" }],
			bodyLinks: [{ link: "Dune" }],
			linkDestMap: { "Dune": { path: "Books/Dune.md" } }
		});
		const file = mockFile({ parent: folder("Reviews") });
		const group = andGroup(
			orGroup(
				filter("file", "links to", "Dune"),
				filter("file", "in folder", "Books")
			),
			filter("file", "has tag", "scifi")
		);
		expect(checkRules(app, group, file)).toBe(true);
	});
});

// ===========================================================================
// REAL VAULT SCENARIOS
// These tests simulate the actual vault files to catch real-world edge cases.
// ===========================================================================

// ---------------------------------------------------------------------------
// Vault-wide link resolution map (simulates getFirstLinkpathDest)
// ---------------------------------------------------------------------------

const VAULT_LINK_MAP: Record<string, { path: string }> = {
	"Books": { path: "Books.md" },
	"Science Fiction": { path: "Science Fiction.md" },
	"Songs": { path: "Songs.md" },
	"Music Videos": { path: "Music Videos.md" },
	"Movies": { path: "Movies.md" },
	"Instagram Posts": { path: "Instagram Posts.md" },
	"Recipes": { path: "Recipes.md" },
	"Projects": { path: "Projects.md" },
	"People": { path: "People.md" },
	"Dune": { path: "Books/Dune.md" },
	"Neuromancer": { path: "Books/Neuromancer.md" },
	"Frank Herbert": { path: "People/Frank Herbert.md" },
	"William Gibson": { path: "People/William Gibson.md" },
	"F. Scott Fitzgerald": { path: "People/F. Scott Fitzgerald.md" },
	"Christopher Nolan": { path: "People/Christopher Nolan.md" },
	"Jonathan Nolan": { path: "People/Jonathan Nolan.md" },
	"Interstellar": { path: "Movies/Interstellar.md" },
	"Decision to Leave": { path: "Movies/Decision to Leave.md" },
	"Alvvays": { path: "Alvvays.md" },
	"Alvvays – Blue Rev|Blue Rev": { path: "Alvvays – Blue Rev.md" },
	"Alec O'Hanley": { path: "People/Alec O'Hanley.md" },
	"Molly Rankin": { path: "People/Molly Rankin.md" },
	"In a Row": { path: "Music/In a Row.md" },
	"Thriller": { path: "Thriller.md" },
	"Mystery": { path: "Mystery.md" },
	"Drama": { path: "Drama.md" },
	"Adventure": { path: "Adventure.md" },
	"Romance": { path: "Romance.md" },
	"Anup": { path: "Anup.md" },
	"Neeraj Ghaywan": { path: "People/Neeraj Ghaywan.md" },
	"Basharat Peer": { path: "People/Basharat Peer.md" },
};

// ---------------------------------------------------------------------------
// Scenario: Books/Dune.md
// - categories: [[[Books]], [[Science Fiction]]]
// - body links: [[Science Fiction]], [[Frank Herbert]]
// - tags: books, scifi, classics
// ---------------------------------------------------------------------------

describe("vault scenario: Books/Dune.md", () => {
	const file = mockFile({
		name: "Dune.md",
		basename: "Dune",
		path: "Books/Dune.md",
		parent: folder("Books"),
		stat: { ctime: 0, mtime: 0, size: 500 }
	});
	const fm = {
		categories: ["[[Books]]", "[[Science Fiction]]"],
		authors: ["[[Frank Herbert]]"],
		published: "1965-08-01",
		rating: 9,
		pages: 412,
		status: "read",
		tags: ["books", "scifi", "classics"]
	};

	function duneApp(extraOpts: Partial<MockAppOptions> = {}) {
		return mockApp({
			bodyTags: [],
			bodyLinks: [{ link: "Science Fiction" }, { link: "Frank Herbert" }],
			linkDestMap: VAULT_LINK_MAP,
			cacheFrontmatter: fm,
			...extraOpts
		});
	}

	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["file", "links to", "Science Fiction", true],
		["file", "links to", "Frank Herbert", true],
		["file", "links to", "Books", true],
		["file", "does not link to", "Movies", true],
		["file", "in folder", "Books", true],
		["file", "in folder", "Movies", false],
		["file", "has tag", "scifi", true],
		["file", "has tag", "classics", true],
		["file", "has tag", "music", false],
		["file", "has property", "rating", true],
		["file", "has property", "cuisine", false],
		["status", "is", "read", true],
		["status", "is not", "unread", true],
		["rating", "is", "9", true],
		["published", "is", "1965-08-01", true],
		["categories", "contains any of", "[[Books]],[[Movies]]", true],
		["categories", "contains all of", "[[Books]],[[Science Fiction]]", true],
		["categories", "does not contain any of", "[[Movies]],[[Recipes]]", true],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(duneApp(), andGroup(filter(field, operator, value)), file, fm)).toBe(expected);
	});

	it("AND: in folder Books AND has tag scifi AND status read", () => {
		const group = andGroup(
			filter("file", "in folder", "Books"),
			filter("file", "has tag", "scifi"),
			filter("status", "is", "read")
		);
		expect(checkRules(duneApp(), group, file, fm)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Scenario: Movies/Interstellar.md
// - categories: [[[Movies]]], genres: [[[Adventure]], [[Drama]], [[Science Fiction]]]
// - directors: [[[Christopher Nolan]]]
// - rating: 7, year: 2014, published: 2014-11-05
// ---------------------------------------------------------------------------

describe("vault scenario: Movies/Interstellar.md", () => {
	const file = mockFile({
		name: "Interstellar.md",
		basename: "Interstellar",
		path: "Movies/Interstellar.md",
		parent: folder("Movies")
	});
	const fm = {
		categories: ["[[Movies]]"],
		genres: ["[[Adventure]]", "[[Drama]]", "[[Science Fiction]]"],
		directors: ["[[Christopher Nolan]]"],
		writers: ["[[Jonathan Nolan]]", "[[Christopher Nolan]]"],
		year: 2014,
		rating: 7,
		runtime: 169,
		published: "2014-11-05",
		created: "",
		last: ""
	};

	function interstellarApp() {
		return mockApp({
			bodyLinks: [],
			linkDestMap: VAULT_LINK_MAP,
			cacheFrontmatter: fm,
		});
	}

	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["file", "links to", "Science Fiction", true],
		["file", "links to", "Christopher Nolan", true],
		["file", "links to", "Frank Herbert", false],
		["file", "in folder", "Movies", true],
		["genres", "contains", "[[Drama]]", true],
		["genres", "contains any of", "[[Horror]],[[Drama]]", true],
		["genres", "does not contain all of", "[[Horror]],[[Drama]]", true],
		["year", "is", "2014", true],
		["rating", "contains", "7", true],
		["created", "is empty", undefined, true],
		["published", "is not empty", undefined, true],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(interstellarApp(), andGroup(filter(field, operator, value)), file, fm)).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// Scenario: Music/Belinda Says.md
// - categories: [[[Songs]]], tags: [music, songs]
// - published: 2022-10-07T07:00:00+05:30 (datetime with timezone)
// - rating: (undefined/missing)
// ---------------------------------------------------------------------------

describe("vault scenario: Music/Belinda Says.md", () => {
	const file = mockFile({
		name: "Belinda Says.md",
		basename: "Belinda Says",
		path: "Music/Belinda Says.md",
		parent: folder("Music")
	});
	const fm = {
		categories: ["[[Songs]]"],
		album: ["[[Alvvays – Blue Rev|Blue Rev]]"],
		track: 11,
		artists: ["[[Alvvays]]"],
		writers: ["[[Alec O'Hanley]]", "[[Molly Rankin]]"],
		first: "2024-12-23T14:08:04+05:30",
		created: "2024-12-23T14:08:04+05:30",
		published: "2022-10-07T07:00:00+05:30",
		tags: ["music", "songs"],
	};

	function belindaApp() {
		return mockApp({
			bodyTags: [],
			bodyLinks: [],
			linkDestMap: VAULT_LINK_MAP,
			cacheFrontmatter: fm,
		});
	}

	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["file", "in folder", "Music", true],
		["file", "has tag", "music", true],
		["file", "has tag", "songs", true],
		["file", "has tag", "books", false],
		["categories", "contains", "[[Songs]]", true],
		["track", "is", "11", true],
		["file", "has property", "album", true],
		["file", "has property", "rating", false],
		["file", "links to", "Songs", true],
		["writers", "contains any of", "[[Alec O'Hanley]],[[Molly Rankin]]", true],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(belindaApp(), andGroup(filter(field, operator, value)), file, fm)).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// Scenario: Recipes/Pasta Aglio e Olio.md
// - cuisine: Italian, vegetarian: true, difficulty: easy
// - tags: recipes, italian, quick-meals
// ---------------------------------------------------------------------------

describe("vault scenario: Recipes/Pasta Aglio e Olio.md", () => {
	const file = mockFile({
		name: "Pasta Aglio e Olio.md",
		basename: "Pasta Aglio e Olio",
		path: "Recipes/Pasta Aglio e Olio.md",
		parent: folder("Recipes")
	});
	const fm = {
		categories: ["[[Recipes]]"],
		cuisine: "Italian",
		servings: 2,
		prepTime: 25,
		difficulty: "easy",
		vegetarian: true,
		tags: ["recipes", "italian", "quick-meals"]
	};

	function recipeApp() {
		return mockApp({
			bodyTags: [],
			bodyLinks: [],
			linkDestMap: VAULT_LINK_MAP,
			cacheFrontmatter: fm,
		});
	}

	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["cuisine", "is", "Italian", true],
		["cuisine", "starts with", "Ital", true],
		["cuisine", "ends with", "ian", true],
		["difficulty", "is not", "hard", true],
		["vegetarian", "is", "true", true],
		["file", "has tag", "quick-meals", true],
		["file", "does not have tag", "music", true],
		["file.basename", "contains", "Pasta", true],
		["file.basename", "contains", "aglio", false],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(recipeApp(), andGroup(filter(field, operator, value)), file, fm)).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// Scenario: Empty Note.md (no frontmatter, no links, no tags)
// ---------------------------------------------------------------------------

describe("vault scenario: Empty Note.md", () => {
	const file = mockFile({
		name: "Empty Note.md",
		basename: "Empty Note",
		path: "Empty Note.md",
		parent: folder("")
	});

	function emptyApp() {
		return mockApp({
			bodyTags: [],
			bodyLinks: [],
			linkDestMap: VAULT_LINK_MAP
		});
	}

	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["file", "does not have property", "status", true],
		["file", "does not link to", "Science Fiction", true],
		["file", "is not in folder", "Books", true],
		["file", "does not have tag", "books", true],
		["file.basename", "is", "Empty Note", true],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(emptyApp(), andGroup(filter(field, operator, value)), file)).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// Scenario: Projects/Plugin Development.md
// - status: active, priority: high, dates, collaborators with wikilinks
// ---------------------------------------------------------------------------

describe("vault scenario: Projects/Plugin Development.md", () => {
	const file = mockFile({
		name: "Plugin Development.md",
		basename: "Plugin Development",
		path: "Projects/Plugin Development.md",
		parent: folder("Projects")
	});
	const fm = {
		categories: ["[[Projects]]"],
		status: "active",
		priority: "high",
		startDate: "2024-11-01",
		dueDate: "2025-06-30",
		collaborators: ["[[Anup]]"],
		tags: ["projects", "coding", "obsidian"]
	};

	function projectApp() {
		return mockApp({
			bodyTags: [],
			bodyLinks: [],
			linkDestMap: VAULT_LINK_MAP,
			cacheFrontmatter: fm,
		});
	}

	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["status", "contains", "activ", true],
		["priority", "is", "high", true],
		["collaborators", "contains", "[[Anup]]", true],
		["file", "links to", "Anup", true],
		["file", "has tag", "obsidian", true],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(projectApp(), andGroup(filter(field, operator, value)), file, fm)).toBe(expected);
	});

	it("NOR: none of these match → true", () => {
		const group = norGroup(
			filter("status", "is", "completed"),
			filter("priority", "is", "low"),
			filter("file", "in folder", "Music")
		);
		expect(checkRules(projectApp(), group, file, fm)).toBe(true);
	});

	it("OR: at least one matches → true", () => {
		const group = orGroup(
			filter("status", "is", "completed"),    // false
			filter("priority", "is", "high"),        // true
			filter("file", "in folder", "Music")     // false
		);
		expect(checkRules(projectApp(), group, file, fm)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Scenario: Movies/Homebound.md (rating: 6, complex wikilinks)
// ---------------------------------------------------------------------------

describe("vault scenario: Movies/Homebound.md", () => {
	const file = mockFile({
		name: "Homebound.md",
		basename: "Homebound",
		path: "Movies/Homebound.md",
		parent: folder("Movies")
	});
	const fm = {
		categories: ["[[Movies]]"],
		genres: ["[[Drama]]"],
		directors: ["[[Neeraj Ghaywan]]"],
		writers: ["[[Neeraj Ghaywan]]", "[[Basharat Peer]]", "[[Sumit Roy]]"],
		rating: 6,
		year: 2025,
		runtime: 122,
		description: "Chandan and Shoaib leave home to apply for police jobs seeking stability and status, but over time, their future and friendship grow uncertain.",
	};

	function homeboundApp() {
		return mockApp({
			bodyLinks: [],
			linkDestMap: VAULT_LINK_MAP,
			cacheFrontmatter: fm,
		});
	}

	it.each<[string, Filter["operator"], string | undefined, boolean]>([
		["file", "links to", "Neeraj Ghaywan", true],
		["description", "contains", "police", true],
		["description", "does not contain", "wormhole", true],
		["writers", "contains all of", "[[Neeraj Ghaywan]],[[Basharat Peer]]", true],
		["writers", "does not contain all of", "[[Neeraj Ghaywan]],[[Christopher Nolan]]", true],
		["year", "is not", "2014", true],
	])("%s %s %s → %s", (field, operator, value, expected) => {
		expect(checkRules(homeboundApp(), andGroup(filter(field, operator, value)), file, fm)).toBe(expected);
	});
});

// ---------------------------------------------------------------------------
// Cross-vault: filter that should match MULTIPLE files
// (Simulates "show me all files that link to Science Fiction")
// ---------------------------------------------------------------------------

describe("cross-vault: 'file links to Science Fiction'", () => {
	const linkToSFFilter = andGroup(filter("file", "links to", "Science Fiction"));

	it("matches Untitled.md (has [[Science Fiction]] in body)", () => {
		const app = mockApp({
			bodyLinks: [{ link: "Science Fiction" }],
			linkDestMap: VAULT_LINK_MAP,
			cacheFrontmatter: { categories: ["[[Books]]", "songs"] }
		});
		const file = mockFile({ basename: "Untitled", path: "Untitled.md", parent: folder("") });
		const fm = { categories: ["[[Books]]", "songs"] };
		expect(checkRules(app, linkToSFFilter, file, fm)).toBe(true);
	});

	it("matches Books/Dune.md (has [[Science Fiction]] in body)", () => {
		const app = mockApp({
			bodyLinks: [{ link: "Science Fiction" }, { link: "Frank Herbert" }],
			linkDestMap: VAULT_LINK_MAP,
			cacheFrontmatter: { categories: ["[[Books]]", "[[Science Fiction]]"] }
		});
		const file = mockFile({ basename: "Dune", path: "Books/Dune.md", parent: folder("Books") });
		const fm = { categories: ["[[Books]]", "[[Science Fiction]]"] };
		expect(checkRules(app, linkToSFFilter, file, fm)).toBe(true);
	});

	it("matches Movies/Interstellar.md (has [[Science Fiction]] in frontmatter genres)", () => {
		const app = mockApp({
			bodyLinks: [],
			linkDestMap: VAULT_LINK_MAP,
			cacheFrontmatter: { genres: ["[[Adventure]]", "[[Drama]]", "[[Science Fiction]]"] }
		});
		const file = mockFile({ basename: "Interstellar", path: "Movies/Interstellar.md", parent: folder("Movies") });
		const fm = { genres: ["[[Adventure]]", "[[Drama]]", "[[Science Fiction]]"] };
		expect(checkRules(app, linkToSFFilter, file, fm)).toBe(true);
	});

	it("does NOT match Music/Belinda Says.md (no link to Science Fiction)", () => {
		const app = mockApp({
			bodyLinks: [],
			linkDestMap: VAULT_LINK_MAP,
			cacheFrontmatter: { categories: ["[[Songs]]"] }
		});
		const file = mockFile({ basename: "Belinda Says", path: "Music/Belinda Says.md", parent: folder("Music") });
		const fm = { categories: ["[[Songs]]"] };
		expect(checkRules(app, linkToSFFilter, file, fm)).toBe(false);
	});

	it("does NOT match Empty Note.md (no links at all)", () => {
		const app = mockApp({ bodyLinks: [], linkDestMap: VAULT_LINK_MAP });
		const file = mockFile({ basename: "Empty Note", path: "Empty Note.md", parent: folder("") });
		expect(checkRules(app, linkToSFFilter, file)).toBe(false);
	});

	it("does NOT match Science Fiction.md itself (it contains [[In a Row]], not [[Science Fiction]])", () => {
		const app = mockApp({
			bodyLinks: [{ link: "In a Row" }],
			linkDestMap: VAULT_LINK_MAP,
		});
		const file = mockFile({ basename: "Science Fiction", path: "Science Fiction.md", parent: folder("") });
		expect(checkRules(app, linkToSFFilter, file)).toBe(false);
	});
});

describe("numeric comparison controls", () => {
	it.each([
		["=", "3", true], ["=", "4", false], ["≠", "3", false], ["≠", "4", true],
		["<", "4", true], ["<", "3", false], ["≤", "3", true], ["≤", "2", false],
		[">", "2", true], [">", "3", false], ["≥", "3", true], ["≥", "4", false],
	] as const)("evaluates 3 %s %s", (operator, value, expected) => {
		expect(checkRules(mockApp(), andGroup(filter("rating", operator, value)), mockFile(), { rating: 3 })).toBe(expected);
	});

	it("supports file size and zero", () => {
		expect(checkRules(mockApp(), andGroup(filter("file.size", ">", "0")), mockFile())).toBe(true);
		expect(checkRules(mockApp(), andGroup(filter("rating", "=", "0")), mockFile(), { rating: 0 })).toBe(true);
	});

	it.each([undefined, "", " ", "\t\n", "\u00a0", "banana", false, []])("does not coerce invalid property %s to zero", rating => {
		expect(checkRules(mockApp(), andGroup(filter("rating", "=", "0")), mockFile(), { rating })).toBe(false);
		expect(checkRules(mockApp(), andGroup(filter("rating", "≠", "1")), mockFile(), { rating })).toBe(false);
	});

	it.each(["", "Infinity", "3foo"])("rejects invalid numeric input %s", value => {
		expect(checkRules(mockApp(), andGroup(filter("rating", "≠", value)), mockFile(), { rating: 3 })).toBe(false);
	});
});

describe("empty property checks", () => {
	it.each([0, false])("treats %s as a populated value", value => {
		expect(checkRules(mockApp(), andGroup(filter("value", "is empty")), mockFile(), { value })).toBe(false);
		expect(checkRules(mockApp(), andGroup(filter("value", "is not empty")), mockFile(), { value })).toBe(true);
	});

	it.each([null, undefined, "", []])("treats missing or empty value %s as empty", value => {
		expect(checkRules(mockApp(), andGroup(filter("value", "is empty")), mockFile(), { value })).toBe(true);
		expect(checkRules(mockApp(), andGroup(filter("value", "is not empty")), mockFile(), { value })).toBe(false);
	});
});

describe("exact list comparison", () => {
	it.each([
		[["a", "b"], "a, a", false],
		[["a", "a"], "a, b", false],
		[["a", "a"], "a, a", true],
		[["b", "a"], "a, b", true],
		[["a", "b", "a"], "a, b, b", false],
	] as const)("compares all occurrences in %j against %s", (values, input, expected) => {
		const items = [...values];
		expect(checkRules(mockApp(), andGroup(filter("items", "is exactly", input)), mockFile(), { items })).toBe(expected);
		expect(checkRules(mockApp(), andGroup(filter("items", "is not exactly", input)), mockFile(), { items })).toBe(!expected);
		expect(items).toEqual(values);
	});
});

describe("calendar date filtering", () => {
	it.each([
		["on", "2024-06-15", true], ["not on", "2024-06-15", false],
		["before", "2024-06-16", true], ["on or before", "2024-06-15", true],
		["after", "2024-06-14", true], ["on or after", "2024-06-15", true],
	] as const)("supports note dates: %s %s", (operator, value, expected) => {
		expect(checkRules(mockApp(), andGroup(filter("published", operator, value)), mockFile(), { published: "2024-06-15" })).toBe(expected);
	});

	it.each(["2024-02-30", "not a date", "", undefined])("rejects invalid dates even with negative comparisons: %s", published => {
		expect(checkRules(mockApp(), andGroup(filter("published", "not on", "2024-06-15")), mockFile(), { published })).toBe(false);
	});

	it("uses the local day at the UTC boundary", () => {
		vi.stubEnv("TZ", "Asia/Kolkata");
		try {
			const timestamp = new Date(2024, 5, 15, 0, 30).getTime();
			const file = mockFile({ stat: { ctime: timestamp, mtime: timestamp, size: 0 } });
			expect(checkRules(mockApp(), andGroup(filter("file.ctime", "on", "2024-06-15")), file)).toBe(true);
		} finally { vi.unstubAllEnvs(); }
	});

	it("accepts the Unix epoch as a populated timestamp", () => {
		expect(checkRules(mockApp(), andGroup(filter("file.ctime", "is not empty")), mockFile())).toBe(true);
	});
});
