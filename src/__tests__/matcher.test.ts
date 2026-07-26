import { describe, it, expect } from "vitest";
import { checkRules } from "../matcher";
import type { FilterGroup, Filter } from "../types";

// ---------------------------------------------------------------------------
// Mock helpers
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

function mockApp(opts: {
	bodyTags?: Array<{ tag: string }>;
	bodyLinks?: Array<{ link: string }>;
	linkDest?: { path: string } | null;
	resolvedLinks?: Record<string, Record<string, number>>;
} = {}) {
	return {
		metadataCache: {
			getFileCache: () => ({ tags: opts.bodyTags ?? [], links: opts.bodyLinks ?? [] }),
			getFirstLinkpathDest: (_l: string, _s: string) => opts.linkDest ?? null,
			resolvedLinks: opts.resolvedLinks ?? {},
		},
	} as unknown as import("obsidian").App;
}

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
		expect(checkRules(mockApp(), andGroup(), mockFile())).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AND / OR / NOR logic
// ---------------------------------------------------------------------------

describe("AND group", () => {
	it("returns true when ALL conditions are true", () => {
		expect(checkRules(mockApp(), andGroup(filter("file.basename", "is", "note"), filter("file.extension", "is", "md")), mockFile())).toBe(true);
	});
	it("returns false when ANY condition is false", () => {
		expect(checkRules(mockApp(), andGroup(filter("file.basename", "is", "note"), filter("file.extension", "is", "txt")), mockFile())).toBe(false);
	});
});

describe("OR group", () => {
	it("returns true when at least one condition is true", () => {
		expect(checkRules(mockApp(), orGroup(filter("file.basename", "is", "wrong"), filter("file.extension", "is", "md")), mockFile())).toBe(true);
	});
	it("returns false when ALL conditions are false", () => {
		expect(checkRules(mockApp(), orGroup(filter("file.basename", "is", "wrong"), filter("file.extension", "is", "txt")), mockFile())).toBe(false);
	});
});

describe("NOR group", () => {
	it("returns true when ALL conditions are false", () => {
		expect(checkRules(mockApp(), norGroup(filter("file.basename", "is", "wrong"), filter("file.extension", "is", "txt")), mockFile())).toBe(true);
	});
	it("returns false when ANY condition is true", () => {
		expect(checkRules(mockApp(), norGroup(filter("file.basename", "is", "wrong"), filter("file.extension", "is", "md")), mockFile())).toBe(false);
	});
});

describe("nested groups", () => {
	it("evaluates nested groups recursively", () => {
		const group = orGroup(
			andGroup(filter("file.basename", "is", "note"), filter("file.extension", "is", "md")),
			filter("file.basename", "is", "other")
		);
		expect(checkRules(mockApp(), group, mockFile())).toBe(true);
	});
	it("returns false when all nested groups fail", () => {
		const group = andGroup(
			orGroup(filter("file.basename", "is", "wrong1"), filter("file.basename", "is", "wrong2")),
			filter("file.extension", "is", "md")
		);
		expect(checkRules(mockApp(), group, mockFile())).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// file.* scalar fields
// ---------------------------------------------------------------------------

describe("file.name", () => {
	it("is", () => expect(checkRules(mockApp(), andGroup(filter("file.name", "is", "note.md")), mockFile())).toBe(true));
	it("is not", () => expect(checkRules(mockApp(), andGroup(filter("file.name", "is not", "other.md")), mockFile())).toBe(true));
	it("contains", () => expect(checkRules(mockApp(), andGroup(filter("file.name", "contains", "note")), mockFile())).toBe(true));
	it("does not contain", () => expect(checkRules(mockApp(), andGroup(filter("file.name", "does not contain", "xyz")), mockFile())).toBe(true));
	it("starts with", () => expect(checkRules(mockApp(), andGroup(filter("file.name", "starts with", "note")), mockFile())).toBe(true));
	it("ends with", () => expect(checkRules(mockApp(), andGroup(filter("file.name", "ends with", ".md")), mockFile())).toBe(true));
});

describe("file.basename", () => {
	it("is", () => expect(checkRules(mockApp(), andGroup(filter("file.basename", "is", "note")), mockFile())).toBe(true));
	it("is not", () => expect(checkRules(mockApp(), andGroup(filter("file.basename", "is not", "note")), mockFile())).toBe(false));
	it("is empty — false when non-empty", () => expect(checkRules(mockApp(), andGroup(filter("file.basename", "is empty")), mockFile())).toBe(false));
	it("is not empty — true when non-empty", () => expect(checkRules(mockApp(), andGroup(filter("file.basename", "is not empty")), mockFile())).toBe(true));
	it("is empty — true when basename is empty", () => expect(checkRules(mockApp(), andGroup(filter("file.basename", "is empty")), mockFile({ basename: "" }))).toBe(true));
});

describe("file.path", () => {
	const file = mockFile({ path: "folder/sub/note.md" });
	it("starts with", () => expect(checkRules(mockApp(), andGroup(filter("file.path", "starts with", "folder")), file)).toBe(true));
	it("ends with", () => expect(checkRules(mockApp(), andGroup(filter("file.path", "ends with", "note.md")), file)).toBe(true));
	it("contains", () => expect(checkRules(mockApp(), andGroup(filter("file.path", "contains", "sub")), file)).toBe(true));
});

describe("file.extension", () => {
	it("is md", () => expect(checkRules(mockApp(), andGroup(filter("file.extension", "is", "md")), mockFile())).toBe(true));
	it("is not pdf", () => expect(checkRules(mockApp(), andGroup(filter("file.extension", "is not", "pdf")), mockFile())).toBe(true));
});

describe("file.size", () => {
	const file = mockFile({ stat: { ctime: 0, mtime: 0, size: 500 } });
	it("is — numeric comparison as string", () => expect(checkRules(mockApp(), andGroup(filter("file.size", "is", "500")), file)).toBe(true));
	it("is not", () => expect(checkRules(mockApp(), andGroup(filter("file.size", "is not", "999")), file)).toBe(true));
});

// ---------------------------------------------------------------------------
// numeric comparison operators (=, ≠, <, ≤, >, ≥)
// ---------------------------------------------------------------------------

describe("numeric comparison operators", () => {
	const file = mockFile({ stat: { ctime: 0, mtime: 0, size: 500 } });
	it("= matches an equal value", () => expect(checkRules(mockApp(), andGroup(filter("file.size", "=", "500")), file)).toBe(true));
	it("= does not match a different value", () => expect(checkRules(mockApp(), andGroup(filter("file.size", "=", "501")), file)).toBe(false));
	it("≠ matches a different value", () => expect(checkRules(mockApp(), andGroup(filter("file.size", "≠", "501")), file)).toBe(true));
	it("≠ does not match an equal value", () => expect(checkRules(mockApp(), andGroup(filter("file.size", "≠", "500")), file)).toBe(false));
	it("< matches a smaller target", () => expect(checkRules(mockApp(), andGroup(filter("file.size", "<", "600")), file)).toBe(true));
	it("< does not match an equal target", () => expect(checkRules(mockApp(), andGroup(filter("file.size", "<", "500")), file)).toBe(false));
	it("≤ matches an equal target", () => expect(checkRules(mockApp(), andGroup(filter("file.size", "≤", "500")), file)).toBe(true));
	it("> matches a larger target", () => expect(checkRules(mockApp(), andGroup(filter("file.size", ">", "400")), file)).toBe(true));
	it("> does not match an equal target", () => expect(checkRules(mockApp(), andGroup(filter("file.size", ">", "500")), file)).toBe(false));
	it("≥ matches an equal target", () => expect(checkRules(mockApp(), andGroup(filter("file.size", "≥", "500")), file)).toBe(true));
	it("returns false when the filter value is not numeric", () => expect(checkRules(mockApp(), andGroup(filter("file.size", ">", "not-a-number")), file)).toBe(false));
});

// ---------------------------------------------------------------------------
// file.outlinks / file.inlinks
// ---------------------------------------------------------------------------

describe("file.outlinks", () => {
	const file = mockFile({ path: "note.md" });
	it("counts resolved links from this file", () => {
		const app = mockApp({ resolvedLinks: { "note.md": { "a.md": 1, "b.md": 1 } } });
		expect(checkRules(app, andGroup(filter("file.outlinks", "=", "2")), file)).toBe(true);
	});
	it("is 0 when the file has no outgoing resolved links", () => {
		const app = mockApp({ resolvedLinks: {} });
		expect(checkRules(app, andGroup(filter("file.outlinks", "=", "0")), file)).toBe(true);
	});
	it("supports > for a minimum link count", () => {
		const app = mockApp({ resolvedLinks: { "note.md": { "a.md": 1, "b.md": 1, "c.md": 1 } } });
		expect(checkRules(app, andGroup(filter("file.outlinks", ">", "2")), file)).toBe(true);
	});
});

describe("file.inlinks", () => {
	const file = mockFile({ path: "note.md" });
	it("counts other files that resolve-link to this file", () => {
		const app = mockApp({
			resolvedLinks: {
				"x.md": { "note.md": 1 },
				"y.md": { "note.md": 1, "z.md": 1 },
			},
		});
		expect(checkRules(app, andGroup(filter("file.inlinks", "=", "2")), file)).toBe(true);
	});
	it("is 0 when no other file links to this one", () => {
		const app = mockApp({ resolvedLinks: { "x.md": { "other.md": 1 } } });
		expect(checkRules(app, andGroup(filter("file.inlinks", "=", "0")), file)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// links to / does not link to
// ---------------------------------------------------------------------------

describe("links to / does not link to", () => {
	it("matches when the file body links to the target", () => {
		const app = mockApp({ bodyLinks: [{ link: "Target" }], linkDest: { path: "target.md" } });
		expect(checkRules(app, andGroup(filter("file", "links to", "Target")), mockFile())).toBe(true);
	});
	it("does not match when the file body has no matching links", () => {
		const app = mockApp({ bodyLinks: [], linkDest: { path: "target.md" } });
		expect(checkRules(app, andGroup(filter("file", "links to", "Target")), mockFile())).toBe(false);
	});
	it("does not link to — true when there is no matching link", () => {
		const app = mockApp({ bodyLinks: [], linkDest: { path: "target.md" } });
		expect(checkRules(app, andGroup(filter("file", "does not link to", "Target")), mockFile())).toBe(true);
	});
	it("does not link to — true when the target file cannot be resolved", () => {
		const app = mockApp({ bodyLinks: [], linkDest: null });
		expect(checkRules(app, andGroup(filter("file", "does not link to", "Missing")), mockFile())).toBe(true);
	});
	it("matches via a [[wikilink]] in frontmatter", () => {
		const app = mockApp({ bodyLinks: [], linkDest: { path: "target.md" } });
		expect(checkRules(app, andGroup(filter("file", "links to", "Target")), mockFile(), { related: "[[Target]]" })).toBe(true);
	});
});

describe("file.folder", () => {
	const file = mockFile({ parent: { path: "projects/work" } });
	it("contains the folder name", () => expect(checkRules(mockApp(), andGroup(filter("file.folder", "contains", "work")), file)).toBe(true));
	it("does not contain an unrelated string", () => expect(checkRules(mockApp(), andGroup(filter("file.folder", "does not contain", "personal")), file)).toBe(true));
});

// ---------------------------------------------------------------------------
// in folder / is not in folder
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
// has tag / does not have tag
// ---------------------------------------------------------------------------

describe("has tag / does not have tag", () => {
	it("matches a body tag (exact)", () => {
		expect(checkRules(mockApp({ bodyTags: [{ tag: "#movies" }] }), andGroup(filter("file", "has tag", "movies")), mockFile())).toBe(true);
	});
	it("matches a parent tag", () => {
		expect(checkRules(mockApp({ bodyTags: [{ tag: "#movies/action" }] }), andGroup(filter("file", "has tag", "movies")), mockFile())).toBe(true);
	});
	it("matches a child tag", () => {
		expect(checkRules(mockApp({ bodyTags: [{ tag: "#movies" }] }), andGroup(filter("file", "has tag", "movies/action")), mockFile())).toBe(true);
	});
	it("matches a frontmatter tag (array)", () => {
		expect(checkRules(mockApp(), andGroup(filter("file", "has tag", "recipe")), mockFile(), { tags: ["recipe", "cooking"] })).toBe(true);
	});
	it("matches a frontmatter tag (string)", () => {
		expect(checkRules(mockApp(), andGroup(filter("file", "has tag", "recipe")), mockFile(), { tags: "recipe" })).toBe(true);
	});
	it("does not match when tag is absent", () => {
		expect(checkRules(mockApp({ bodyTags: [{ tag: "#movies" }] }), andGroup(filter("file", "has tag", "books")), mockFile())).toBe(false);
	});
	it("does not have tag — true when tag is absent", () => {
		expect(checkRules(mockApp({ bodyTags: [{ tag: "#movies" }] }), andGroup(filter("file", "does not have tag", "books")), mockFile())).toBe(true);
	});
	it("does not have tag — false when tag is present", () => {
		expect(checkRules(mockApp({ bodyTags: [{ tag: "#movies" }] }), andGroup(filter("file", "does not have tag", "movies")), mockFile())).toBe(false);
	});
	it("accepts multiple comma-separated tags (OR logic)", () => {
		expect(checkRules(mockApp({ bodyTags: [{ tag: "#movies" }] }), andGroup(filter("file", "has tag", "books,movies")), mockFile())).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// has property / does not have property
// ---------------------------------------------------------------------------

describe("has property / does not have property", () => {
	it("has property — true when present", () => expect(checkRules(mockApp(), andGroup(filter("file", "has property", "status")), mockFile(), { status: "done" })).toBe(true));
	it("has property — false when missing", () => expect(checkRules(mockApp(), andGroup(filter("file", "has property", "status")), mockFile(), { title: "My Note" })).toBe(false));
	it("does not have property — true when missing", () => expect(checkRules(mockApp(), andGroup(filter("file", "does not have property", "status")), mockFile(), { title: "My Note" })).toBe(true));
	it("does not have property — false when present", () => expect(checkRules(mockApp(), andGroup(filter("file", "does not have property", "status")), mockFile(), { status: "done" })).toBe(false));
	it("has property — false with no frontmatter", () => expect(checkRules(mockApp(), andGroup(filter("file", "has property", "status")), mockFile())).toBe(false));
});

// ---------------------------------------------------------------------------
// Frontmatter scalar fields
// ---------------------------------------------------------------------------

describe("frontmatter scalar field", () => {
	const fm = { status: "done", priority: 3, draft: false };
	it("is", () => expect(checkRules(mockApp(), andGroup(filter("status", "is", "done")), mockFile(), fm)).toBe(true));
	it("is not", () => expect(checkRules(mockApp(), andGroup(filter("status", "is not", "pending")), mockFile(), fm)).toBe(true));
	it("contains", () => expect(checkRules(mockApp(), andGroup(filter("status", "contains", "don")), mockFile(), fm)).toBe(true));
	it("does not contain", () => expect(checkRules(mockApp(), andGroup(filter("status", "does not contain", "xyz")), mockFile(), fm)).toBe(true));
	it("starts with", () => expect(checkRules(mockApp(), andGroup(filter("status", "starts with", "do")), mockFile(), fm)).toBe(true));
	it("ends with", () => expect(checkRules(mockApp(), andGroup(filter("status", "ends with", "ne")), mockFile(), fm)).toBe(true));
	it("is empty — false when non-empty", () => expect(checkRules(mockApp(), andGroup(filter("status", "is empty")), mockFile(), fm)).toBe(false));
	it("is not empty — true when non-empty", () => expect(checkRules(mockApp(), andGroup(filter("status", "is not empty")), mockFile(), fm)).toBe(true));
	it("is empty — true when field missing", () => expect(checkRules(mockApp(), andGroup(filter("missing_field", "is empty")), mockFile(), fm)).toBe(true));
	it("contains any of — matches", () => expect(checkRules(mockApp(), andGroup(filter("status", "contains any of", "pending,done")), mockFile(), fm)).toBe(true));
	it("contains any of — false", () => expect(checkRules(mockApp(), andGroup(filter("status", "contains any of", "pending,archived")), mockFile(), fm)).toBe(false));
	it("contains all of — true", () => expect(checkRules(mockApp(), andGroup(filter("status", "contains all of", "don,ne")), mockFile(), fm)).toBe(true));
	it("contains all of — false", () => expect(checkRules(mockApp(), andGroup(filter("status", "contains all of", "done,xyz")), mockFile(), fm)).toBe(false));
	it("does not contain any of — true", () => expect(checkRules(mockApp(), andGroup(filter("status", "does not contain any of", "pending,archived")), mockFile(), fm)).toBe(true));
	it("does not contain all of — true", () => expect(checkRules(mockApp(), andGroup(filter("status", "does not contain all of", "done,xyz")), mockFile(), fm)).toBe(true));
});

// ---------------------------------------------------------------------------
// Frontmatter array fields
// ---------------------------------------------------------------------------

describe("frontmatter array field", () => {
	const fm = { categories: ["fiction", "thriller", "mystery"] };
	it("is — any element matches", () => expect(checkRules(mockApp(), andGroup(filter("categories", "is", "thriller")), mockFile(), fm)).toBe(true));
	it("is — false when no element matches", () => expect(checkRules(mockApp(), andGroup(filter("categories", "is", "biography")), mockFile(), fm)).toBe(false));
	it("is not — true when no element matches", () => expect(checkRules(mockApp(), andGroup(filter("categories", "is not", "biography")), mockFile(), fm)).toBe(true));
	it("contains — partial match", () => expect(checkRules(mockApp(), andGroup(filter("categories", "contains", "rill")), mockFile(), fm)).toBe(true));
	it("does not contain — false when match found", () => expect(checkRules(mockApp(), andGroup(filter("categories", "does not contain", "rill")), mockFile(), fm)).toBe(false));
	it("is empty — false for non-empty array", () => expect(checkRules(mockApp(), andGroup(filter("categories", "is empty")), mockFile(), fm)).toBe(false));
	it("is not empty — true for non-empty array", () => expect(checkRules(mockApp(), andGroup(filter("categories", "is not empty")), mockFile(), fm)).toBe(true));
	it("is empty — true for empty array", () => expect(checkRules(mockApp(), andGroup(filter("categories", "is empty")), mockFile(), { categories: [] as string[] })).toBe(true));
	it("contains any of — true", () => expect(checkRules(mockApp(), andGroup(filter("categories", "contains any of", "biography,fiction")), mockFile(), fm)).toBe(true));
	it("contains any of — false", () => expect(checkRules(mockApp(), andGroup(filter("categories", "contains any of", "biography,horror")), mockFile(), fm)).toBe(false));
	it("contains all of — true", () => expect(checkRules(mockApp(), andGroup(filter("categories", "contains all of", "fiction,thriller")), mockFile(), fm)).toBe(true));
	it("contains all of — false", () => expect(checkRules(mockApp(), andGroup(filter("categories", "contains all of", "fiction,horror")), mockFile(), fm)).toBe(false));
	it("does not contain any of — true", () => expect(checkRules(mockApp(), andGroup(filter("categories", "does not contain any of", "biography,horror")), mockFile(), fm)).toBe(true));
	it("does not contain all of — true", () => expect(checkRules(mockApp(), andGroup(filter("categories", "does not contain all of", "fiction,horror")), mockFile(), fm)).toBe(true));
});

// ---------------------------------------------------------------------------
// file.ctime date operators
// ---------------------------------------------------------------------------

describe("file.ctime date operators", () => {
	const createdDate = new Date("2024-06-15T12:00:00Z");
	const file = mockFile({ stat: { ctime: createdDate.getTime(), mtime: 0, size: 0 } });

	it("on — true for same date", () => expect(checkRules(mockApp(), andGroup(filter("file.ctime", "on", "2024-06-15")), file)).toBe(true));
	it("on — false for different date", () => expect(checkRules(mockApp(), andGroup(filter("file.ctime", "on", "2024-06-14")), file)).toBe(false));
	it("not on — true for different date", () => expect(checkRules(mockApp(), andGroup(filter("file.ctime", "not on", "2024-06-14")), file)).toBe(true));
	it("before — true for earlier date", () => expect(checkRules(mockApp(), andGroup(filter("file.ctime", "before", "2024-06-16")), file)).toBe(true));
	it("before — false for same date", () => expect(checkRules(mockApp(), andGroup(filter("file.ctime", "before", "2024-06-15")), file)).toBe(false));
	it("on or before — true for same date", () => expect(checkRules(mockApp(), andGroup(filter("file.ctime", "on or before", "2024-06-15")), file)).toBe(true));
	it("after — true for later date", () => expect(checkRules(mockApp(), andGroup(filter("file.ctime", "after", "2024-06-14")), file)).toBe(true));
	it("after — false for same date", () => expect(checkRules(mockApp(), andGroup(filter("file.ctime", "after", "2024-06-15")), file)).toBe(false));
	it("on or after — true for same date", () => expect(checkRules(mockApp(), andGroup(filter("file.ctime", "on or after", "2024-06-15")), file)).toBe(true));
	it("is not empty — true for non-zero timestamp", () => expect(checkRules(mockApp(), andGroup(filter("file.ctime", "is not empty")), file)).toBe(true));
	it("is empty — false for non-zero timestamp", () => expect(checkRules(mockApp(), andGroup(filter("file.ctime", "is empty")), file)).toBe(false));
});

// ---------------------------------------------------------------------------
// within past / within future — timestamp fields
// ---------------------------------------------------------------------------

describe("within past / within future — file.mtime", () => {
	const tenMinutesAgoMs = Date.now() - 10 * 60 * 1000;
	const file = mockFile({ stat: { ctime: 0, mtime: tenMinutesAgoMs, size: 0 } });

	it("within past — true when mtime is within the window", () => {
		expect(checkRules(mockApp(), andGroup(filter("file.mtime", "within past", "1 hours")), file)).toBe(true);
	});
	it("within past — false when window is too small", () => {
		expect(checkRules(mockApp(), andGroup(filter("file.mtime", "within past", "1 minutes")), file)).toBe(false);
	});
	it("within future — false for a past timestamp", () => {
		expect(checkRules(mockApp(), andGroup(filter("file.mtime", "within future", "1 hours")), file)).toBe(false);
	});

	const tenMinutesFromNowMs = Date.now() + 10 * 60 * 1000;
	const futureFile = mockFile({ stat: { ctime: 0, mtime: tenMinutesFromNowMs, size: 0 } });
	it("within future — true when mtime is in the future window", () => {
		expect(checkRules(mockApp(), andGroup(filter("file.mtime", "within future", "1 hours")), futureFile)).toBe(true);
	});
	it("within future — false when window is too small", () => {
		expect(checkRules(mockApp(), andGroup(filter("file.mtime", "within future", "1 minutes")), futureFile)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// within past / within future — frontmatter date strings
// ---------------------------------------------------------------------------

describe("within past / within future — frontmatter date string", () => {
	// Use 3-day buffers so local-midnight vs UTC-ms timezone differences (max ~26h) cannot flip the result
	const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
	const fiveDaysFromNow = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

	it("within past — true for a date string from 3 days ago", () => {
		expect(checkRules(mockApp(), andGroup(filter("due", "within past", "7 days")), mockFile(), { due: threeDaysAgo })).toBe(true);
	});
	it("within past — false when window is too small", () => {
		expect(checkRules(mockApp(), andGroup(filter("due", "within past", "1 hours")), mockFile(), { due: threeDaysAgo })).toBe(false);
	});
	it("within future — true for a date string 5 days from now", () => {
		expect(checkRules(mockApp(), andGroup(filter("due", "within future", "7 days")), mockFile(), { due: fiveDaysFromNow })).toBe(true);
	});
	it("within future — false for a past date string", () => {
		expect(checkRules(mockApp(), andGroup(filter("due", "within future", "7 days")), mockFile(), { due: threeDaysAgo })).toBe(false);
	});
	it("returns false for an invalid date string", () => {
		expect(checkRules(mockApp(), andGroup(filter("due", "within past", "3 days")), mockFile(), { due: "not-a-date" })).toBe(false);
	});
	it("matches when frontmatter parses an unquoted date into a native Date object", () => {
		// Obsidian's YAML parser turns unquoted dates (e.g. `due: 2024-06-15`) into Date objects, not strings.
		const threeDaysAgoDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
		expect(checkRules(mockApp(), andGroup(filter("due", "within past", "7 days")), mockFile(), { due: threeDaysAgoDate as unknown as string })).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Unsupported operators on array fields (return false, not an error)
// ---------------------------------------------------------------------------

describe("unsupported operators on array fields", () => {
    const fm = { tags: ["a", "b", "c"] };
    it("starts with — returns false for array targets", () => {
        expect(checkRules(mockApp(), andGroup(filter("tags", "starts with", "a")), mockFile(), fm)).toBe(false);
    });
    it("ends with — returns false for array targets", () => {
        expect(checkRules(mockApp(), andGroup(filter("tags", "ends with", "c")), mockFile(), fm)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// file tags field
// ---------------------------------------------------------------------------

describe("file tags field operators", () => {
	it("contains — true when tag present", () => {
		expect(checkRules(mockApp({ bodyTags: [{ tag: "#movies" }] }), andGroup(filter("file tags", "contains", "movies")), mockFile())).toBe(true);
	});
	it("does not contain — true when tag absent", () => {
		expect(checkRules(mockApp({ bodyTags: [{ tag: "#movies" }] }), andGroup(filter("file tags", "does not contain", "books")), mockFile())).toBe(true);
	});
	it("is — exact match on a tag element", () => {
		expect(checkRules(mockApp({ bodyTags: [{ tag: "#movies" }] }), andGroup(filter("file tags", "is", "movies")), mockFile())).toBe(true);
	});
	it("is empty — true when no tags", () => {
		expect(checkRules(mockApp({ bodyTags: [] }), andGroup(filter("file tags", "is empty")), mockFile())).toBe(true);
	});
	it("is not empty — true when tags exist", () => {
		expect(checkRules(mockApp({ bodyTags: [{ tag: "#movies" }] }), andGroup(filter("file tags", "is not empty")), mockFile())).toBe(true);
	});
	it("includes frontmatter tags", () => {
		expect(checkRules(mockApp({ bodyTags: [] }), andGroup(filter("file tags", "contains", "cooking")), mockFile(), { tags: ["cooking"] })).toBe(true);
	});
});
