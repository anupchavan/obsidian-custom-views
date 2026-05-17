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
}

function mockApp(opts: MockAppOptions = {}) {
	return {
		metadataCache: {
			getFileCache: () => ({
				tags: opts.bodyTags ?? [],
				links: opts.bodyLinks ?? [],
			}),
			getFirstLinkpathDest: (_linkpath: string, _sourcePath: string) =>
				opts.linkDest ?? null,
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
});
