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

import { describe, it, expect } from "vitest";
import { checkRules } from "../matcher";
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
	parent?: { path: string } | null;
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
	it("is — exact match", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.name", "is", "note.md")), mockFile())).toBe(true));
	it("is not — mismatch returns true", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.name", "is not", "other.md")), mockFile())).toBe(true));
	it("contains", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.name", "contains", "note")), mockFile())).toBe(true));
	it("does not contain", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.name", "does not contain", "xyz")), mockFile())).toBe(true));
	it("starts with", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.name", "starts with", "note")), mockFile())).toBe(true));
	it("ends with", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.name", "ends with", ".md")), mockFile())).toBe(true));
});

describe("file.basename", () => {
	it("is", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.basename", "is", "note")), mockFile())).toBe(true));
	it("is not", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.basename", "is not", "note")), mockFile())).toBe(false));
	it("is empty — false when non-empty", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.basename", "is empty")), mockFile())).toBe(false));
	it("is not empty — true when non-empty", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.basename", "is not empty")), mockFile())).toBe(true));
	it("is empty — true when basename is empty string", () => {
		expect(checkRules(mockApp(), andGroup(filter("file.basename", "is empty")), mockFile({ basename: "" }))).toBe(true);
	});
});

describe("file.path", () => {
	const file = mockFile({ path: "folder/sub/note.md" });
	it("starts with", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.path", "starts with", "folder")), file)).toBe(true));
	it("ends with", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.path", "ends with", "note.md")), file)).toBe(true));
	it("contains", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.path", "contains", "sub")), file)).toBe(true));
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
	const file = mockFile({ parent: { path: "projects/work" } });
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
		const file = mockFile({ parent: { path: "work" } });
		expect(checkRules(mockApp(), andGroup(filter("file", "in folder", "work")), file)).toBe(true);
	});

	it("matches file in a sub-folder of target", () => {
		const file = mockFile({ parent: { path: "work/projects" } });
		expect(checkRules(mockApp(), andGroup(filter("file", "in folder", "work")), file)).toBe(true);
	});

	it("does not match file in a different folder", () => {
		const file = mockFile({ parent: { path: "personal" } });
		expect(checkRules(mockApp(), andGroup(filter("file", "in folder", "work")), file)).toBe(false);
	});

	it("is not in folder — true when file is elsewhere", () => {
		const file = mockFile({ parent: { path: "personal" } });
		expect(checkRules(mockApp(), andGroup(filter("file", "is not in folder", "work")), file)).toBe(true);
	});

	it("is not in folder — false when file is there", () => {
		const file = mockFile({ parent: { path: "work" } });
		expect(checkRules(mockApp(), andGroup(filter("file", "is not in folder", "work")), file)).toBe(false);
	});

	it("handles leading/trailing slashes on folder value", () => {
		const file = mockFile({ parent: { path: "work" } });
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

	it("matches a child tag (fileTag is 'movies', filter is 'movies/action')", () => {
		const app = mockApp({ bodyTags: [{ tag: "#movies" }] });
		expect(checkRules(app, andGroup(filter("file", "has tag", "movies/action")), mockFile())).toBe(true);
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

	it("is — string match", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "is", "done")), mockFile(), fm)).toBe(true));
	it("is not — mismatch", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "is not", "pending")), mockFile(), fm)).toBe(true));
	it("contains", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "contains", "don")), mockFile(), fm)).toBe(true));
	it("does not contain", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "does not contain", "xyz")), mockFile(), fm)).toBe(true));
	it("starts with", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "starts with", "do")), mockFile(), fm)).toBe(true));
	it("ends with", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "ends with", "ne")), mockFile(), fm)).toBe(true));
	it("is empty — false when value is non-empty", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "is empty")), mockFile(), fm)).toBe(false));
	it("is not empty — true when value is non-empty", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "is not empty")), mockFile(), fm)).toBe(true));
	it("is empty — true when field is missing", () =>
		expect(checkRules(mockApp(), andGroup(filter("missing_field", "is empty")), mockFile(), fm)).toBe(true));

	it("contains any of — matches when any value found", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "contains any of", "pending,done")), mockFile(), fm)).toBe(true));
	it("contains any of — false when none found", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "contains any of", "pending,archived")), mockFile(), fm)).toBe(false));
	it("contains all of — true when all values found", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "contains all of", "don,ne")), mockFile(), fm)).toBe(true));
	it("contains all of — false when not all values found", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "contains all of", "done,xyz")), mockFile(), fm)).toBe(false));
	it("does not contain any of — true when none found", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "does not contain any of", "pending,archived")), mockFile(), fm)).toBe(true));
	it("does not contain all of — true when not all found", () =>
		expect(checkRules(mockApp(), andGroup(filter("status", "does not contain all of", "done,xyz")), mockFile(), fm)).toBe(true));
});

// ---------------------------------------------------------------------------
// Frontmatter array (list) fields
// ---------------------------------------------------------------------------

describe("frontmatter array field", () => {
	const fm = { categories: ["fiction", "thriller", "mystery"] };

	it("is — checks if any element exactly matches", () =>
		expect(checkRules(mockApp(), andGroup(filter("categories", "is", "thriller")), mockFile(), fm)).toBe(true));
	it("is — false when no element matches", () =>
		expect(checkRules(mockApp(), andGroup(filter("categories", "is", "biography")), mockFile(), fm)).toBe(false));
	it("is not — true when no element matches", () =>
		expect(checkRules(mockApp(), andGroup(filter("categories", "is not", "biography")), mockFile(), fm)).toBe(true));
	it("contains — partial match within element", () =>
		expect(checkRules(mockApp(), andGroup(filter("categories", "contains", "rill")), mockFile(), fm)).toBe(true));
	it("does not contain — false when match found", () =>
		expect(checkRules(mockApp(), andGroup(filter("categories", "does not contain", "rill")), mockFile(), fm)).toBe(false));
	it("is empty — false for non-empty array", () =>
		expect(checkRules(mockApp(), andGroup(filter("categories", "is empty")), mockFile(), fm)).toBe(false));
	it("is not empty — true for non-empty array", () =>
		expect(checkRules(mockApp(), andGroup(filter("categories", "is not empty")), mockFile(), fm)).toBe(true));
	it("is empty — true for empty array", () => {
		const emptyFm = { categories: [] as string[] };
		expect(checkRules(mockApp(), andGroup(filter("categories", "is empty")), mockFile(), emptyFm)).toBe(true);
	});

	it("contains any of — true when any filter value matches any element", () =>
		expect(checkRules(mockApp(), andGroup(filter("categories", "contains any of", "biography,fiction")), mockFile(), fm)).toBe(true));
	it("contains any of — false when nothing matches", () =>
		expect(checkRules(mockApp(), andGroup(filter("categories", "contains any of", "biography,horror")), mockFile(), fm)).toBe(false));
	it("contains all of — true when all filter values match", () =>
		expect(checkRules(mockApp(), andGroup(filter("categories", "contains all of", "fiction,thriller")), mockFile(), fm)).toBe(true));
	it("contains all of — false when one filter value missing", () =>
		expect(checkRules(mockApp(), andGroup(filter("categories", "contains all of", "fiction,horror")), mockFile(), fm)).toBe(false));
	it("does not contain any of — true when none match", () =>
		expect(checkRules(mockApp(), andGroup(filter("categories", "does not contain any of", "biography,horror")), mockFile(), fm)).toBe(true));
	it("does not contain all of — true when not all match", () =>
		expect(checkRules(mockApp(), andGroup(filter("categories", "does not contain all of", "fiction,horror")), mockFile(), fm)).toBe(true));
});

// ---------------------------------------------------------------------------
// file.ctime / file.mtime date operators
// ---------------------------------------------------------------------------

describe("file.ctime date operators", () => {
	// A file created on 2024-06-15
	const createdDate = new Date("2024-06-15T12:00:00Z");
	const file = mockFile({ stat: { ctime: createdDate.getTime(), mtime: 0, size: 0 } });

	it("on — true for same date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.ctime", "on", "2024-06-15")), file)).toBe(true));
	it("on — false for different date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.ctime", "on", "2024-06-14")), file)).toBe(false));
	it("not on — true for different date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.ctime", "not on", "2024-06-14")), file)).toBe(true));
	it("before — true for earlier date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.ctime", "before", "2024-06-16")), file)).toBe(true));
	it("before — false for same date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.ctime", "before", "2024-06-15")), file)).toBe(false));
	it("on or before — true for same date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.ctime", "on or before", "2024-06-15")), file)).toBe(true));
	it("after — true for later date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.ctime", "after", "2024-06-14")), file)).toBe(true));
	it("after — false for same date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.ctime", "after", "2024-06-15")), file)).toBe(false));
	it("on or after — true for same date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.ctime", "on or after", "2024-06-15")), file)).toBe(true));
	it("is not empty — true for non-zero timestamp", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.ctime", "is not empty")), file)).toBe(true));
	it("is empty — false for non-zero timestamp", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.ctime", "is empty")), file)).toBe(false));
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

	it("= — equal", () =>
		expect(checkRules(mockApp(), andGroup(filter("rating", "is", "8")), mockFile(), fm)).toBe(true));
	it("= — not equal returns false", () =>
		expect(checkRules(mockApp(), andGroup(filter("rating", "is", "5")), mockFile(), fm)).toBe(false));
	it("≠ — not equal", () =>
		expect(checkRules(mockApp(), andGroup(filter("rating", "is not", "5")), mockFile(), fm)).toBe(true));
	it("is empty — false for existing number", () =>
		expect(checkRules(mockApp(), andGroup(filter("rating", "is empty")), mockFile(), fm)).toBe(false));
	it("is not empty — true for existing number", () =>
		expect(checkRules(mockApp(), andGroup(filter("rating", "is not empty")), mockFile(), fm)).toBe(true));
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

	it("on — true for same date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.mtime", "on", "2025-01-10")), file)).toBe(true));
	it("on — false for different date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.mtime", "on", "2025-01-09")), file)).toBe(false));
	it("before — true for later date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.mtime", "before", "2025-01-11")), file)).toBe(true));
	it("after — true for earlier date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.mtime", "after", "2025-01-09")), file)).toBe(true));
	it("on or before — true for same date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.mtime", "on or before", "2025-01-10")), file)).toBe(true));
	it("on or after — true for same date", () =>
		expect(checkRules(mockApp(), andGroup(filter("file.mtime", "on or after", "2025-01-10")), file)).toBe(true));
});

// ---------------------------------------------------------------------------
// Complex combined scenarios
// ---------------------------------------------------------------------------

describe("complex combined filters", () => {
	it("AND: file in folder AND has tag AND property value", () => {
		const app = mockApp({ bodyTags: [{ tag: "#fiction" }] });
		const file = mockFile({ parent: { path: "Books" } });
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
		const file = mockFile({ parent: { path: "Books" } });
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
		const file = mockFile({ parent: { path: "Music" } });
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
		const file = mockFile({ parent: { path: "Music" } });
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
		const file = mockFile({ parent: { path: "Reviews" } });
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
		parent: { path: "Books" },
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

	// links to
	it("file links to 'Science Fiction' — true (body link)", () => {
		expect(checkRules(duneApp(), andGroup(filter("file", "links to", "Science Fiction")), file, fm)).toBe(true);
	});

	it("file links to 'Frank Herbert' — true (body link)", () => {
		expect(checkRules(duneApp(), andGroup(filter("file", "links to", "Frank Herbert")), file, fm)).toBe(true);
	});

	it("file links to 'Books' — true (frontmatter wikilink [[Books]])", () => {
		expect(checkRules(duneApp(), andGroup(filter("file", "links to", "Books")), file, fm)).toBe(true);
	});

	it("file does not link to 'Movies' — true", () => {
		expect(checkRules(duneApp(), andGroup(filter("file", "does not link to", "Movies")), file, fm)).toBe(true);
	});

	// in folder
	it("file in folder 'Books' — true", () => {
		expect(checkRules(duneApp(), andGroup(filter("file", "in folder", "Books")), file)).toBe(true);
	});

	it("file in folder 'Movies' — false", () => {
		expect(checkRules(duneApp(), andGroup(filter("file", "in folder", "Movies")), file)).toBe(false);
	});

	// has tag (frontmatter tags)
	it("file has tag 'scifi' — true", () => {
		expect(checkRules(duneApp(), andGroup(filter("file", "has tag", "scifi")), file, fm)).toBe(true);
	});

	it("file has tag 'classics' — true", () => {
		expect(checkRules(duneApp(), andGroup(filter("file", "has tag", "classics")), file, fm)).toBe(true);
	});

	it("file has tag 'music' — false", () => {
		expect(checkRules(duneApp(), andGroup(filter("file", "has tag", "music")), file, fm)).toBe(false);
	});

	// has property
	it("file has property 'rating' — true", () => {
		expect(checkRules(duneApp(), andGroup(filter("file", "has property", "rating")), file, fm)).toBe(true);
	});

	it("file has property 'cuisine' — false", () => {
		expect(checkRules(duneApp(), andGroup(filter("file", "has property", "cuisine")), file, fm)).toBe(false);
	});

	// frontmatter values
	it("status is 'read'", () => {
		expect(checkRules(duneApp(), andGroup(filter("status", "is", "read")), file, fm)).toBe(true);
	});

	it("status is not 'unread'", () => {
		expect(checkRules(duneApp(), andGroup(filter("status", "is not", "unread")), file, fm)).toBe(true);
	});

	it("rating is '9'", () => {
		expect(checkRules(duneApp(), andGroup(filter("rating", "is", "9")), file, fm)).toBe(true);
	});

	it("published is '1965-08-01'", () => {
		expect(checkRules(duneApp(), andGroup(filter("published", "is", "1965-08-01")), file, fm)).toBe(true);
	});

	// categories array — contains any of
	it("categories contains any of '[[Books]],[[Movies]]' — true", () => {
		expect(checkRules(duneApp(), andGroup(filter("categories", "contains any of", "[[Books]],[[Movies]]")), file, fm)).toBe(true);
	});

	it("categories contains all of '[[Books]],[[Science Fiction]]' — true", () => {
		expect(checkRules(duneApp(), andGroup(filter("categories", "contains all of", "[[Books]],[[Science Fiction]]")), file, fm)).toBe(true);
	});

	it("categories does not contain any of '[[Movies]],[[Recipes]]' — true", () => {
		expect(checkRules(duneApp(), andGroup(filter("categories", "does not contain any of", "[[Movies]],[[Recipes]]")), file, fm)).toBe(true);
	});

	// combined
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
		parent: { path: "Movies" }
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

	it("file links to 'Science Fiction' via frontmatter genres — true", () => {
		expect(checkRules(interstellarApp(), andGroup(filter("file", "links to", "Science Fiction")), file, fm)).toBe(true);
	});

	it("file links to 'Christopher Nolan' via frontmatter directors — true", () => {
		expect(checkRules(interstellarApp(), andGroup(filter("file", "links to", "Christopher Nolan")), file, fm)).toBe(true);
	});

	it("file links to 'Frank Herbert' — false (no such link)", () => {
		expect(checkRules(interstellarApp(), andGroup(filter("file", "links to", "Frank Herbert")), file, fm)).toBe(false);
	});

	it("file in folder 'Movies' — true", () => {
		expect(checkRules(interstellarApp(), andGroup(filter("file", "in folder", "Movies")), file)).toBe(true);
	});

	it("genres contains '[[Drama]]'", () => {
		expect(checkRules(interstellarApp(), andGroup(filter("genres", "contains", "[[Drama]]")), file, fm)).toBe(true);
	});

	it("genres contains any of '[[Horror]],[[Drama]]' — true", () => {
		expect(checkRules(interstellarApp(), andGroup(filter("genres", "contains any of", "[[Horror]],[[Drama]]")), file, fm)).toBe(true);
	});

	it("genres does not contain all of '[[Horror]],[[Drama]]' — true (no Horror)", () => {
		expect(checkRules(interstellarApp(), andGroup(filter("genres", "does not contain all of", "[[Horror]],[[Drama]]")), file, fm)).toBe(true);
	});

	it("year is '2014'", () => {
		expect(checkRules(interstellarApp(), andGroup(filter("year", "is", "2014")), file, fm)).toBe(true);
	});

	it("rating contains '7'", () => {
		expect(checkRules(interstellarApp(), andGroup(filter("rating", "contains", "7")), file, fm)).toBe(true);
	});

	it("created is empty — true (empty string)", () => {
		expect(checkRules(interstellarApp(), andGroup(filter("created", "is empty")), file, fm)).toBe(true);
	});

	it("published is not empty — true", () => {
		expect(checkRules(interstellarApp(), andGroup(filter("published", "is not empty")), file, fm)).toBe(true);
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
		parent: { path: "Music" }
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

	it("file in folder 'Music' — true", () => {
		expect(checkRules(belindaApp(), andGroup(filter("file", "in folder", "Music")), file)).toBe(true);
	});

	it("file has tag 'music' (frontmatter) — true", () => {
		expect(checkRules(belindaApp(), andGroup(filter("file", "has tag", "music")), file, fm)).toBe(true);
	});

	it("file has tag 'songs' (frontmatter) — true", () => {
		expect(checkRules(belindaApp(), andGroup(filter("file", "has tag", "songs")), file, fm)).toBe(true);
	});

	it("file has tag 'books' — false", () => {
		expect(checkRules(belindaApp(), andGroup(filter("file", "has tag", "books")), file, fm)).toBe(false);
	});

	it("categories contains '[[Songs]]'", () => {
		expect(checkRules(belindaApp(), andGroup(filter("categories", "contains", "[[Songs]]")), file, fm)).toBe(true);
	});

	it("track is '11'", () => {
		expect(checkRules(belindaApp(), andGroup(filter("track", "is", "11")), file, fm)).toBe(true);
	});

	it("file has property 'album' — true", () => {
		expect(checkRules(belindaApp(), andGroup(filter("file", "has property", "album")), file, fm)).toBe(true);
	});

	it("file has property 'rating' — false (missing)", () => {
		expect(checkRules(belindaApp(), andGroup(filter("file", "has property", "rating")), file, fm)).toBe(false);
	});

	it("file links to 'Songs' via frontmatter categories — true", () => {
		expect(checkRules(belindaApp(), andGroup(filter("file", "links to", "Songs")), file, fm)).toBe(true);
	});

	it("writers contains any of '[[Alec O\\'Hanley]],[[Molly Rankin]]' — true", () => {
		expect(checkRules(belindaApp(), andGroup(filter("writers", "contains any of", "[[Alec O'Hanley]],[[Molly Rankin]]")), file, fm)).toBe(true);
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
		parent: { path: "Recipes" }
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

	it("cuisine is 'Italian'", () => {
		expect(checkRules(recipeApp(), andGroup(filter("cuisine", "is", "Italian")), file, fm)).toBe(true);
	});

	it("cuisine starts with 'Ital'", () => {
		expect(checkRules(recipeApp(), andGroup(filter("cuisine", "starts with", "Ital")), file, fm)).toBe(true);
	});

	it("cuisine ends with 'ian'", () => {
		expect(checkRules(recipeApp(), andGroup(filter("cuisine", "ends with", "ian")), file, fm)).toBe(true);
	});

	it("difficulty is not 'hard'", () => {
		expect(checkRules(recipeApp(), andGroup(filter("difficulty", "is not", "hard")), file, fm)).toBe(true);
	});

	it("vegetarian is 'true'", () => {
		expect(checkRules(recipeApp(), andGroup(filter("vegetarian", "is", "true")), file, fm)).toBe(true);
	});

	it("file has tag 'quick-meals' — true", () => {
		expect(checkRules(recipeApp(), andGroup(filter("file", "has tag", "quick-meals")), file, fm)).toBe(true);
	});

	it("file does not have tag 'music' — true", () => {
		expect(checkRules(recipeApp(), andGroup(filter("file", "does not have tag", "music")), file, fm)).toBe(true);
	});

	it("file.basename contains 'Pasta'", () => {
		expect(checkRules(recipeApp(), andGroup(filter("file.basename", "contains", "Pasta")), file)).toBe(true);
	});

	it("file.basename contains 'aglio' — false (case-sensitive)", () => {
		expect(checkRules(recipeApp(), andGroup(filter("file.basename", "contains", "aglio")), file)).toBe(false);
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
		parent: { path: "" }
	});

	function emptyApp() {
		return mockApp({
			bodyTags: [],
			bodyLinks: [],
			linkDestMap: VAULT_LINK_MAP
		});
	}

	it("file does not have property 'anything' — true", () => {
		expect(checkRules(emptyApp(), andGroup(filter("file", "does not have property", "status")), file)).toBe(true);
	});

	it("file does not link to anything — true", () => {
		expect(checkRules(emptyApp(), andGroup(filter("file", "does not link to", "Science Fiction")), file)).toBe(true);
	});

	it("file is not in folder 'Books' — true (root level)", () => {
		expect(checkRules(emptyApp(), andGroup(filter("file", "is not in folder", "Books")), file)).toBe(true);
	});

	it("file does not have tag 'anything' — true", () => {
		expect(checkRules(emptyApp(), andGroup(filter("file", "does not have tag", "books")), file)).toBe(true);
	});

	it("file.basename is 'Empty Note'", () => {
		expect(checkRules(emptyApp(), andGroup(filter("file.basename", "is", "Empty Note")), file)).toBe(true);
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
		parent: { path: "Projects" }
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

	it("status contains 'activ'", () => {
		expect(checkRules(projectApp(), andGroup(filter("status", "contains", "activ")), file, fm)).toBe(true);
	});

	it("priority is 'high'", () => {
		expect(checkRules(projectApp(), andGroup(filter("priority", "is", "high")), file, fm)).toBe(true);
	});

	it("collaborators contains '[[Anup]]'", () => {
		expect(checkRules(projectApp(), andGroup(filter("collaborators", "contains", "[[Anup]]")), file, fm)).toBe(true);
	});

	it("file links to 'Anup' via frontmatter collaborators — true", () => {
		expect(checkRules(projectApp(), andGroup(filter("file", "links to", "Anup")), file, fm)).toBe(true);
	});

	it("file has tag 'obsidian' — true", () => {
		expect(checkRules(projectApp(), andGroup(filter("file", "has tag", "obsidian")), file, fm)).toBe(true);
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
		parent: { path: "Movies" }
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

	it("file links to 'Neeraj Ghaywan' via frontmatter directors — true", () => {
		expect(checkRules(homeboundApp(), andGroup(filter("file", "links to", "Neeraj Ghaywan")), file, fm)).toBe(true);
	});

	it("description contains 'police' — true", () => {
		expect(checkRules(homeboundApp(), andGroup(filter("description", "contains", "police")), file, fm)).toBe(true);
	});

	it("description does not contain 'wormhole' — true", () => {
		expect(checkRules(homeboundApp(), andGroup(filter("description", "does not contain", "wormhole")), file, fm)).toBe(true);
	});

	it("writers contains all of '[[Neeraj Ghaywan]],[[Basharat Peer]]' — true", () => {
		expect(checkRules(homeboundApp(), andGroup(filter("writers", "contains all of", "[[Neeraj Ghaywan]],[[Basharat Peer]]")), file, fm)).toBe(true);
	});

	it("writers does not contain all of '[[Neeraj Ghaywan]],[[Christopher Nolan]]' — true", () => {
		expect(checkRules(homeboundApp(), andGroup(filter("writers", "does not contain all of", "[[Neeraj Ghaywan]],[[Christopher Nolan]]")), file, fm)).toBe(true);
	});

	it("year is not '2014' — true", () => {
		expect(checkRules(homeboundApp(), andGroup(filter("year", "is not", "2014")), file, fm)).toBe(true);
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
		const file = mockFile({ basename: "Untitled", path: "Untitled.md", parent: { path: "" } });
		const fm = { categories: ["[[Books]]", "songs"] };
		expect(checkRules(app, linkToSFFilter, file, fm)).toBe(true);
	});

	it("matches Books/Dune.md (has [[Science Fiction]] in body)", () => {
		const app = mockApp({
			bodyLinks: [{ link: "Science Fiction" }, { link: "Frank Herbert" }],
			linkDestMap: VAULT_LINK_MAP,
			cacheFrontmatter: { categories: ["[[Books]]", "[[Science Fiction]]"] }
		});
		const file = mockFile({ basename: "Dune", path: "Books/Dune.md", parent: { path: "Books" } });
		const fm = { categories: ["[[Books]]", "[[Science Fiction]]"] };
		expect(checkRules(app, linkToSFFilter, file, fm)).toBe(true);
	});

	it("matches Movies/Interstellar.md (has [[Science Fiction]] in frontmatter genres)", () => {
		const app = mockApp({
			bodyLinks: [],
			linkDestMap: VAULT_LINK_MAP,
			cacheFrontmatter: { genres: ["[[Adventure]]", "[[Drama]]", "[[Science Fiction]]"] }
		});
		const file = mockFile({ basename: "Interstellar", path: "Movies/Interstellar.md", parent: { path: "Movies" } });
		const fm = { genres: ["[[Adventure]]", "[[Drama]]", "[[Science Fiction]]"] };
		expect(checkRules(app, linkToSFFilter, file, fm)).toBe(true);
	});

	it("does NOT match Music/Belinda Says.md (no link to Science Fiction)", () => {
		const app = mockApp({
			bodyLinks: [],
			linkDestMap: VAULT_LINK_MAP,
			cacheFrontmatter: { categories: ["[[Songs]]"] }
		});
		const file = mockFile({ basename: "Belinda Says", path: "Music/Belinda Says.md", parent: { path: "Music" } });
		const fm = { categories: ["[[Songs]]"] };
		expect(checkRules(app, linkToSFFilter, file, fm)).toBe(false);
	});

	it("does NOT match Empty Note.md (no links at all)", () => {
		const app = mockApp({ bodyLinks: [], linkDestMap: VAULT_LINK_MAP });
		const file = mockFile({ basename: "Empty Note", path: "Empty Note.md", parent: { path: "" } });
		expect(checkRules(app, linkToSFFilter, file)).toBe(false);
	});

	it("does NOT match Science Fiction.md itself (it contains [[In a Row]], not [[Science Fiction]])", () => {
		const app = mockApp({
			bodyLinks: [{ link: "In a Row" }],
			linkDestMap: VAULT_LINK_MAP,
		});
		const file = mockFile({ basename: "Science Fiction", path: "Science Fiction.md", parent: { path: "" } });
		expect(checkRules(app, linkToSFFilter, file)).toBe(false);
	});
});
