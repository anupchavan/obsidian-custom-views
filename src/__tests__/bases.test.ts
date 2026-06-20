import { describe, expect, it, vi } from "vitest";
import { Component, MarkdownRenderer, StringValue, TFile } from "obsidian";
import type { BasesView } from "obsidian";
import type { App } from "obsidian";
import {
	createCollectorBaseDocuments,
	extractEmbeddedBaseBlocks,
	extractEmbeddedBaseFileLinks,
	templateReferencesBases,
} from "../bases/code-blocks";
import {
	extractTemplateBaseBlocks,
	stripTemplateBaseBlocks,
} from "../bases/template-syntax";
import {
	CUSTOM_VIEWS_BASES_ORIGINAL_TYPE_KEY,
	CUSTOM_VIEWS_BASES_REQUEST_ID_KEY,
	CUSTOM_VIEWS_BASES_SOURCE_INDEX_KEY,
	CUSTOM_VIEWS_BASES_VIEW_INDEX_KEY,
	CUSTOM_VIEWS_BASES_VIEW_TYPE,
	type BasesDataProvider,
	type TemplateBases,
} from "../bases/types";
import { normalizeBasesView } from "../bases/normalize";
import { renderTemplate } from "../renderer";

function makeMockFile(overrides: Partial<TFile> = {}): TFile {
	return {
		name: "Book.md",
		basename: "Book",
		path: "Books/Book.md",
		extension: "md",
		stat: { size: 123, ctime: 1000, mtime: 2000 },
		parent: { path: "Books" },
		...overrides,
		// eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
	} as unknown as TFile;
}

function makeMockApp(): App {
	return {
		metadataCache: {
			getFileCache: vi.fn().mockReturnValue({ frontmatter: {} }),
			getFirstLinkpathDest: vi.fn().mockReturnValue(null),
		},
		vault: {
			cachedRead: vi.fn().mockResolvedValue(""),
		},
	} as unknown as App;
}

function makeBases(overrides: {
	category?: string;
	key?: string;
	name?: string;
	sourceName?: string;
	rows?: { basename: string; category: string | string[] }[];
} = {}): TemplateBases {
	const category = overrides.category ?? "Songs";
	const rows = overrides.rows ?? [{ basename: "No Fear No More", category }];
	return [{
		key: overrides.key,
		name: overrides.name ?? "Songs",
		type: "table",
		index: 0,
		source: { kind: "code-block", index: 0, line: 3, name: overrides.sourceName },
		columns: [
			{ id: "file.name", key: "name", name: "File name", type: "file" },
			{ id: "note.categories", key: "categories", name: "Categories", type: "note" },
		],
		rows: rows.map(row => ({
			file: {
				name: `${row.basename}.md`,
				basename: row.basename,
				path: `Music/${row.basename}.md`,
				folder: "Music",
				ext: "md",
				link: `[[Music/${row.basename}|${row.basename}]]`,
				properties: {},
			},
			values: {
				"file.name": row.basename,
				name: row.basename,
				"note.categories": row.category,
				categories: row.category,
			},
			text: {
				"file.name": row.basename,
				name: row.basename,
				"note.categories": Array.isArray(row.category) ? row.category.join(", ") : row.category,
				categories: Array.isArray(row.category) ? row.category.join(", ") : row.category,
			},
			cells: [],
		})),
		rowCount: rows.length,
	}];
}

describe("embedded Bases code blocks", () => {
	it("extracts fenced base blocks and reports source line numbers", () => {
		const markdown = [
			"# Dashboard",
			"",
			"```base",
			"views:",
			"  - type: table",
			"    name: Songs",
			"```",
			"",
			"~~~base",
			"views: []",
			"~~~",
		].join("\n");

		const blocks = extractEmbeddedBaseBlocks(markdown);

		expect(blocks).toHaveLength(2);
		expect(blocks[0].content).toContain("name: Songs");
		expect(blocks[0].line).toBe(3);
		expect(blocks[1].content).toBe("views: []");
		expect(blocks[1].line).toBe(9);
	});

	it("extracts embedded .base wikilinks and optional view names", () => {
		const markdown = [
			"# Dashboard",
			"",
			"![[Untitled.base]]",
			"![[Folder/Library.base#Cards|Library cards]]",
			"![[Not a base.md]]",
		].join("\n");

		const links = extractEmbeddedBaseFileLinks(markdown);

		expect(links).toHaveLength(2);
		expect(links[0]).toMatchObject({
			target: "Untitled.base",
			viewName: undefined,
			line: 3,
		});
		expect(links[1]).toMatchObject({
			target: "Folder/Library.base",
			viewName: "Cards",
			display: "Library cards",
			line: 4,
		});
	});

	it("creates one collector document for the default rendered view", () => {
		let nextId = 0;
		const documents = createCollectorBaseDocuments({
			filters: 'file.hasTag("music")',
			views: [
				{ type: "table", name: "Songs", order: ["file.name", "note.categories"] },
				{ type: "cards", name: "Covers", limit: 5 },
			],
		}, 2, () => `request-${++nextId}`);

		expect(documents).toHaveLength(1);
		expect(documents[0].requestId).toBe("request-1");
		expect(documents[0].viewName).toBe("Songs");
		expect(documents[0].originalType).toBe("table");

		const views = documents[0].config.views as Record<string, unknown>[];
		const firstView = views[0];
		expect(firstView.type).toBe(CUSTOM_VIEWS_BASES_VIEW_TYPE);
		expect(firstView[CUSTOM_VIEWS_BASES_REQUEST_ID_KEY]).toBe("request-1");
		expect(firstView[CUSTOM_VIEWS_BASES_SOURCE_INDEX_KEY]).toBe(2);
		expect(firstView[CUSTOM_VIEWS_BASES_VIEW_INDEX_KEY]).toBe(0);
		expect(firstView[CUSTOM_VIEWS_BASES_ORIGINAL_TYPE_KEY]).toBe("table");
		expect(firstView.order).toEqual(["file.name", "note.categories"]);

		const originalViews = documents[0].config.views as unknown[];
		expect(originalViews).toHaveLength(1);
	});

	it("creates a collector document for the requested embedded base view", () => {
		const documents = createCollectorBaseDocuments({
			views: [
				{ type: "table", name: "Songs" },
				{ type: "cards", name: "Covers", limit: 5 },
			],
		}, 0, () => "request-1", "Covers");

		expect(documents).toHaveLength(1);
		expect(documents[0].viewName).toBe("Covers");
		expect(documents[0].viewIndex).toBe(1);
		expect(documents[0].originalType).toBe("cards");
	});

	it("detects templates that need Bases data", () => {
		expect(templateReferencesBases("{{file.bases[0].rows}}")).toBe(true);
		expect(templateReferencesBases("{% for row in file.baseViews[0].rows %}x{% endfor %}")).toBe(true);
		expect(templateReferencesBases("{% for row in bases.Songs.rows %}x{% endfor %}")).toBe(true);
		expect(templateReferencesBases("{{baseViews.Songs.rowCount}}")).toBe(true);
		expect(templateReferencesBases("{{bases}}")).toBe(true);
		expect(templateReferencesBases("{{title}}", ".x { color: red; }")).toBe(false);
	});

	it("extracts native YAML template Base blocks and strips them from rendered templates", () => {
		const template = [
			"<h1>{{file.basename}}</h1>",
			"{% base \"Songs\" %}",
			"formulas:",
			"  Untitled: (40/60).round()",
			"views:",
			"  - type: table",
			"    name: Table",
			"{% endbase %}",
			"{% for row in bases.Songs.rows %}{{row.file.basename}}{% endfor %}",
		].join("\n");

		const blocks = extractTemplateBaseBlocks(template);
		const stripped = stripTemplateBaseBlocks(template);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			name: "Songs",
			content: [
				"formulas:",
				"  Untitled: (40/60).round()",
				"views:",
				"  - type: table",
				"    name: Table",
			].join("\n"),
			line: 2,
		});
		expect(stripped).toContain("<h1>{{file.basename}}</h1>");
		expect(stripped).toContain("{% for row in bases.Songs.rows %}");
		expect(stripped).not.toContain("formulas:");
	});

	it("adds row file frontmatter properties without requiring Base columns", () => {
		const rowFile = makeMockFile({
			name: "Movie.md",
			basename: "Movie",
			path: "Movies/Movie.md",
		});
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => ({
					frontmatter: {
						cast: [{ cover: "[[Covers/Actor.jpg]]" }],
						rating: 5,
					},
				})),
			},
		};
		const view = {
			app,
			config: {
				getDisplayName: (propertyId: string) => propertyId,
			},
			data: {
				properties: ["file.name"],
				data: [{
					file: rowFile,
					getValue: () => new StringValue("Movie"),
				}],
			},
		} as unknown as BasesView;

		const [row] = normalizeBasesView(view, {
			sourceKind: "file-embed",
			sourceIndex: 0,
			sourceLine: 1,
			sourceName: "Source alias",
			viewIndex: 0,
			viewName: "Rows",
			originalType: "table",
		}).rows;

		expect(row.file.cast).toEqual([{ cover: "[[Covers/Actor.jpg]]" }]);
		expect(row.file.properties.cast).toEqual([{ cover: "[[Covers/Actor.jpg]]" }]);
		expect(row.file.rating).toBe(5);
		expect(row.values.cast).toBeUndefined();
	});
});

describe("Bases template access", () => {
	it("renders legacy paths through file.bases", async () => {
		const app = makeMockApp();
		const file = makeMockFile();
		const container = window.document.createElement("div");
		const getEmbeddedBases = vi.fn().mockResolvedValue(makeBases());
		const basesProvider: BasesDataProvider = {
			getEmbeddedBases,
		};

		await renderTemplate(
			app,
			"<p>{{file.bases[0].rows[0].values.categories}}</p>",
			file,
			container,
			new Component(),
			false,
			undefined,
			undefined,
			false,
			"```base\nviews: []\n```",
			basesProvider,
		);

		expect(container.textContent).toContain("Songs");
		expect(getEmbeddedBases).toHaveBeenCalledOnce();
	});

	it("renders expression loops through file.bases", async () => {
		const app = makeMockApp();
		const file = makeMockFile();
		const container = window.document.createElement("div");
		const getEmbeddedBases = vi.fn().mockResolvedValue(makeBases());
		const basesProvider: BasesDataProvider = {
			getEmbeddedBases,
		};

		await renderTemplate(
			app,
			"{% for row in file.bases[0].rows %}<div>{{row.file.basename}}: {{row.values.categories}}</div>{% endfor %}",
			file,
			container,
			new Component(),
			false,
			undefined,
			undefined,
			false,
			"```base\nviews: []\n```",
			basesProvider,
		);

		expect(container.textContent).toContain("No Fear No More: Songs");
		expect(getEmbeddedBases).toHaveBeenCalledOnce();
	});

	it("renders template-defined Base YAML through a named lookup", async () => {
		const app = makeMockApp();
		const file = makeMockFile();
		const container = window.document.createElement("div");
		const getEmbeddedBases = vi.fn().mockResolvedValue(makeBases({
			key: "Songs",
			name: "Table",
			sourceName: "Songs",
		}));
		const basesProvider: BasesDataProvider = {
			getEmbeddedBases,
		};
		const template = [
			"<h1>{{file.basename}}</h1>",
			"{% base \"Songs\" %}",
			"formulas:",
			"  Untitled: (40/60).round()",
			"properties:",
			"  formula.Untitled:",
			"    displayName: test",
			"views:",
			"  - type: table",
			"    name: Table",
			"    order:",
			"      - file.name",
			"      - categories",
			"{% endbase %}",
			"<p>{{bases.Songs.rowCount}}</p>",
			"{% for row in bases.Songs.rows %}<div>{{row.file.basename}} - {{row.values.categories}}</div>{% endfor %}",
		].join("\n");

		await renderTemplate(
			app,
			template,
			file,
			container,
			new Component(),
			false,
			undefined,
			undefined,
			false,
			"fallback note content",
			basesProvider,
		);

		expect(container.textContent).toContain("Book");
		expect(container.textContent).toContain("1");
		expect(container.textContent).toContain("No Fear No More - Songs");
		expect(container.textContent).not.toContain("formulas:");
		expect(getEmbeddedBases).toHaveBeenCalledOnce();
		expect(getEmbeddedBases.mock.calls[0][0]).toMatchObject({
			templateContent: template,
			sourceContent: "fallback note content",
		});
	});

	it("renders Markdown-like values from file.bases loops through MarkdownRenderer", async () => {
		const app = makeMockApp();
		const file = makeMockFile();
		const container = window.document.createElement("div");
		const renderedMarkdown: string[] = [];
		const renderSpy = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (
			_app: unknown,
			markdown: string,
			el: HTMLElement,
		) => {
			renderedMarkdown.push(markdown);
			el.textContent = markdown;
		});
		const getEmbeddedBases = vi.fn().mockResolvedValue(makeBases({ category: "[[Songs]]" }));
		const basesProvider: BasesDataProvider = {
			getEmbeddedBases,
		};

		try {
			await renderTemplate(
				app,
				"{% for row in file.bases[0].rows %}<div>{{row.values.categories}}</div>{% endfor %}",
				file,
				container,
				new Component(),
				false,
				undefined,
				undefined,
				false,
				"```base\nviews: []\n```",
				basesProvider,
			);
		} finally {
			renderSpy.mockRestore();
		}

		expect(renderedMarkdown).toContain("[[Songs]]");
		expect(getEmbeddedBases).toHaveBeenCalledOnce();
	});

	it("renders every Markdown-like value from repeated file.bases rows", async () => {
		const app = makeMockApp();
		const file = makeMockFile();
		const container = window.document.createElement("div");
		const renderedMarkdown: string[] = [];
		const renderSpy = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (
			_app: unknown,
			markdown: string,
			el: HTMLElement,
		) => {
			renderedMarkdown.push(markdown);
			el.textContent = markdown;
		});
		const getEmbeddedBases = vi.fn().mockResolvedValue(makeBases({
			rows: [
				{ basename: "A Silent Voice", category: "[[Movies]]" },
				{ basename: "Belinda Says", category: "[[Songs]]" },
				{ basename: "In Undertow", category: ["[[Music Videos]]", "[[Songs]]"] },
				{ basename: "Neuromancer", category: ["[[Books]]", "[[Science Fiction]]"] },
			],
		}));
		const basesProvider: BasesDataProvider = {
			getEmbeddedBases,
		};

		try {
			await renderTemplate(
				app,
				"{% for row in file.bases[0].rows %}<div>{{row.file.basename}}</div><span>{{row.values.categories}}</span>{% endfor %}",
				file,
				container,
				new Component(),
				false,
				undefined,
				undefined,
				false,
				"```base\nviews: []\n```",
				basesProvider,
			);
		} finally {
			renderSpy.mockRestore();
		}

		expect(renderedMarkdown).toEqual(expect.arrayContaining([
			"[[Movies]]",
			"[[Songs]]",
			"[[Music Videos]], [[Songs]]",
			"[[Books]], [[Science Fiction]]",
		]));
		expect(getEmbeddedBases).toHaveBeenCalledOnce();
	});

	it("supports nested loops over array values from file.bases rows", async () => {
		const app = makeMockApp();
		const file = makeMockFile();
		const container = window.document.createElement("div");
		const renderedMarkdown: string[] = [];
		const renderSpy = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (
			_app: unknown,
			markdown: string,
			el: HTMLElement,
		) => {
			renderedMarkdown.push(markdown);
			el.textContent = markdown;
		});
		const getEmbeddedBases = vi.fn().mockResolvedValue(makeBases({
			rows: [
				{ basename: "Belinda Says", category: ["[[Songs]]"] },
				{ basename: "In Undertow", category: ["[[Music Videos]]", "[[Songs]]"] },
			],
		}));
		const basesProvider: BasesDataProvider = {
			getEmbeddedBases,
		};

		try {
			await renderTemplate(
				app,
				[
					"{% for row in file.bases[0].rows %}",
					"<div>{{row.file.basename}}</div>",
					"<ul class=\"categories\">",
					"{% for ok in row.values.categories %}",
					"<li>{{ok}}</li>",
					"{% endfor %}",
					"</ul>",
					"{% endfor %}",
				].join("\n"),
				file,
				container,
				new Component(),
				false,
				undefined,
				undefined,
				false,
				"```base\nviews: []\n```",
				basesProvider,
			);
		} finally {
			renderSpy.mockRestore();
		}

		expect(container.querySelectorAll("li")).toHaveLength(3);
		expect(renderedMarkdown).toEqual(expect.arrayContaining([
			"[[Songs]]",
			"[[Music Videos]]",
		]));
		expect(container.textContent).toContain("Belinda Says");
		expect(container.textContent).toContain("In Undertow");
		expect(getEmbeddedBases).toHaveBeenCalledOnce();
	});

	it("supports nested row.file frontmatter chains from Bases rows", async () => {
		const app = makeMockApp();
		const file = makeMockFile();
		const container = window.document.createElement("div");
		const renderedMarkdown: string[] = [];
		const renderSpy = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (
			_app: unknown,
			markdown: string,
			el: HTMLElement,
		) => {
			renderedMarkdown.push(markdown);
			el.textContent = markdown;
		});
		const bases = makeBases();
		bases[0].rows[0].file.cast = [{ cover: "[[Covers/Actor.jpg]]" }];
		const getEmbeddedBases = vi.fn().mockResolvedValue(bases);
		const basesProvider: BasesDataProvider = {
			getEmbeddedBases,
		};

		try {
			await renderTemplate(
				app,
				"{% for row in file.bases[0].rows %}{% for ok in row.file.cast %}<li>{{ok.cover}}</li>{% endfor %}{% endfor %}",
				file,
				container,
				new Component(),
				false,
				undefined,
				undefined,
				false,
				"```base\nviews: []\n```",
				basesProvider,
			);
		} finally {
			renderSpy.mockRestore();
		}

		expect(renderedMarkdown).toContain("[[Covers/Actor.jpg]]");
		expect(getEmbeddedBases).toHaveBeenCalledOnce();
	});

	it("supports linked-property chains from row.file frontmatter", async () => {
		const actorFile = makeMockFile({
			name: "Actor.md",
			basename: "Actor",
			path: "People/Actor.md",
		});
		const getFirstLinkpathDest = vi.fn((target: string) => target === "Actor" ? actorFile : null);
		const app = {
			metadataCache: {
				getFileCache: vi.fn((file: TFile) => file.path === actorFile.path
					? { frontmatter: { cover: "[[Covers/Actor.jpg]]" } }
					: { frontmatter: {} }),
				getFirstLinkpathDest,
			},
			vault: {
				cachedRead: vi.fn().mockResolvedValue(""),
			},
		} as unknown as App;
		const file = makeMockFile();
		const container = window.document.createElement("div");
		const renderedMarkdown: string[] = [];
		const renderSpy = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (
			_app: unknown,
			markdown: string,
			el: HTMLElement,
		) => {
			renderedMarkdown.push(markdown);
			el.textContent = markdown;
		});
		const bases = makeBases();
		bases[0].rows[0].file.cast = ["[[Actor]]"];
		const getEmbeddedBases = vi.fn().mockResolvedValue(bases);
		const basesProvider: BasesDataProvider = {
			getEmbeddedBases,
		};

		try {
			await renderTemplate(
				app,
				"{% for row in file.bases[0].rows %}<li>{{row.file.cast[0].cover}}</li>{% endfor %}",
				file,
				container,
				new Component(),
				false,
				undefined,
				undefined,
				false,
				"```base\nviews: []\n```",
				basesProvider,
			);
		} finally {
			renderSpy.mockRestore();
		}

		expect(renderedMarkdown).toContain("[[Covers/Actor.jpg]]");
		expect(getFirstLinkpathDest).toHaveBeenCalledWith("Actor", file.path);
		expect(getEmbeddedBases).toHaveBeenCalledOnce();
	});

	it("does not collect Bases data when the template does not reference it", async () => {
		const app = makeMockApp();
		const file = makeMockFile();
		const container = window.document.createElement("div");
		const getEmbeddedBases = vi.fn().mockResolvedValue(makeBases());
		const basesProvider: BasesDataProvider = {
			getEmbeddedBases,
		};

		await renderTemplate(
			app,
			"<p>{{file.name}}</p>",
			file,
			container,
			new Component(),
			false,
			undefined,
			undefined,
			false,
			"```base\nviews: []\n```",
			basesProvider,
		);

		expect(container.textContent).toContain("Book.md");
		expect(getEmbeddedBases).not.toHaveBeenCalled();
	});
});
