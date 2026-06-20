import { describe, expect, it, vi } from "vitest";
import { Component, MarkdownRenderer, StringValue, TFile } from "obsidian";
import type { App, BasesView, Plugin } from "obsidian";
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
	type BasesDataProvider,
	type TemplateBases,
} from "../bases/types";
import { buildBasesCollection } from "../bases/access";
import { normalizeBasesView } from "../bases/normalize";
import { EmbeddedBasesProvider } from "../bases/provider";
import { renderTemplate } from "../renderer";
import type { ViewConfig } from "../types";

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

type MockTFileOverrides = Partial<Omit<TFile, "parent">> & {
	parent?: { path: string } | null;
};

function makeTFile(overrides: MockTFileOverrides = {}): TFile {
	const file = new TFile();
	Object.assign(file, {
		name: "Book.md",
		basename: "Book",
		path: "Books/Book.md",
		extension: "md",
		stat: { size: 123, ctime: 1000, mtime: 2000 },
		parent: { path: "Books" },
	}, overrides);
	return file;
}

function makePlugin(app: App = makeProviderApp()): Plugin & { registerBasesView: ReturnType<typeof vi.fn> } {
	return {
		app,
		registerBasesView: vi.fn(() => true),
	} as unknown as Plugin & { registerBasesView: ReturnType<typeof vi.fn> };
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

function makeProviderApp(options: {
	sourceContent?: string;
	neverFinish?: boolean;
	delayViewMs?: number;
	onReadFakeFile?: (content: string, viewSubpath: string | undefined) => void;
} = {}): App {
	const sourceContent = options.sourceContent ?? [
		"```base",
		JSON.stringify({
			views: [
				{ type: "table", name: "Songs" },
			],
		}),
		"```",
	].join("\n");
	const app = {
		metadataCache: {
			getFileCache: vi.fn(() => ({ frontmatter: {} })),
			getFirstLinkpathDest: vi.fn(() => null),
		},
		vault: {
			read: vi.fn(async () => {
				throw new Error("vault.read was not patched for the fake Base file");
			}),
			cachedRead: vi.fn(async () => sourceContent),
			modify: vi.fn(async () => undefined),
			create: vi.fn(async (path: string) => makeTFile({
				name: path,
				basename: path.replace(/\.base$/i, ""),
				path,
				extension: "base",
			})),
			getFileByPath: vi.fn(() => null),
		},
		embedRegistry: {
			embedByExtension: {
				base: vi.fn((_: unknown, file: TFile, viewSubpath?: string) => {
					const selectedViewName = viewSubpath?.startsWith("#")
						? viewSubpath.substring(1)
						: "";
					const controller = {
						currentFile: undefined as TFile | undefined,
						view: null as BasesView | null,
						queue: {
							queue: {
								runnable: {
									running: true,
								},
							},
						},
					};
					return {
						controller,
						containingFile: undefined as TFile | undefined,
						loadFile: vi.fn(async () => {
							const content = await (app as unknown as App).vault.read(file);
							options.onReadFakeFile?.(content, viewSubpath);
							if (!options.neverFinish) {
								controller.queue.queue.runnable.running = false;
								const setView = () => {
									controller.view = makeProviderBasesView(
										app as unknown as App,
										selectedViewName || "Songs",
									);
								};
								if (options.delayViewMs) {
									window.setTimeout(setView, options.delayViewMs);
								} else {
									setView();
								}
							}
						}),
						unload: vi.fn(),
					};
				}),
			},
		},
	};
	return app as unknown as App;
}

function makeProviderBasesView(app: App, viewName: string): BasesView {
	const rowFile = makeTFile({
		name: "Belinda Says.md",
		basename: "Belinda Says",
		path: "Music/Belinda Says.md",
	});
	return {
		app,
		config: {
			getDisplayName: (propertyId: string) => propertyId,
			get: () => null,
		},
		data: {
			properties: ["file.name", "note.categories"],
			data: [{
				file: rowFile,
				getValue: (propertyId: string) => propertyId === "note.categories"
					? new StringValue("Songs")
					: new StringValue(rowFile.basename),
			}],
		},
		type: "table",
		name: viewName,
	} as unknown as BasesView;
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
		const documents = createCollectorBaseDocuments({
			filters: 'file.hasTag("music")',
			views: [
				{ type: "table", name: "Songs", order: ["file.name", "note.categories"] },
				{ type: "cards", name: "Covers", limit: 5 },
			],
		}, 2);

		expect(documents).toHaveLength(1);
		expect(documents[0].viewName).toBe("Songs");
		expect(documents[0].originalType).toBe("table");

		const views = documents[0].config.views as Record<string, unknown>[];
		const firstView = views[0];
		expect(firstView.type).toBe("table");
		expect(firstView.customViewsRequestId).toBeUndefined();
		expect(firstView.customViewsSourceIndex).toBeUndefined();
		expect(firstView.customViewsViewIndex).toBeUndefined();
		expect(firstView.customViewsOriginalType).toBeUndefined();
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
		}, 0, "Covers");

		expect(documents).toHaveLength(1);
		expect(documents[0].viewName).toBe("Covers");
		expect(documents[0].viewIndex).toBe(1);
		expect(documents[0].originalType).toBe("cards");
	});

	it("preserves native Base YAML fields while wrapping the selected view", () => {
		const documents = createCollectorBaseDocuments({
			formulas: {
				Score: "(rating * 10).round()",
			},
			properties: {
				"formula.Score": { displayName: "Score" },
			},
			filters: {
				and: [
					{ property: "note.status", op: "is", value: "active" },
				],
			},
			views: [
				{
					type: "table",
					name: "Table",
					order: ["file.name", "formula.Score"],
					sort: [{ property: "formula.Score", direction: "DESC" }],
					limit: 25,
					groupBy: "note.category",
					map: { property: "note.location" },
				},
				{ type: "cards", name: "Cards", limit: 5 },
			],
		}, 0);

		expect(documents).toHaveLength(1);
		expect(documents[0].config).toMatchObject({
			formulas: {
				Score: "(rating * 10).round()",
			},
			properties: {
				"formula.Score": { displayName: "Score" },
			},
			filters: {
				and: [
					{ property: "note.status", op: "is", value: "active" },
				],
			},
		});
		expect(documents[0].config.views).toEqual([
			expect.objectContaining({
				type: "table",
				name: "Table",
				order: ["file.name", "formula.Score"],
				sort: [{ property: "formula.Score", direction: "DESC" }],
				limit: 25,
				groupBy: "note.category",
				map: { property: "note.location" },
			}),
		]);
	});

	it("detects templates that need Bases data", () => {
		expect(templateReferencesBases("{{file.bases[0].rows}}")).toBe(true);
		expect(templateReferencesBases("{% for row in file.baseViews[0].rows %}x{% endfor %}")).toBe(true);
		expect(templateReferencesBases("{% for row in bases.Songs.rows %}x{% endfor %}")).toBe(true);
		expect(templateReferencesBases("{{baseViews.Songs.rowCount}}")).toBe(true);
		expect(templateReferencesBases("{{bases}}")).toBe(true);
		expect(templateReferencesBases("{{title}}", ".x { color: red; }")).toBe(false);
	});

	it("does not treat unrelated base-like words as Bases references", () => {
		expect(templateReferencesBases("{{file.basename}}")).toBe(false);
		expect(templateReferencesBases(".x { --bases-table-header-background: red; }")).toBe(false);
		expect(templateReferencesBases("const baseOrder = []; const baseMap = {};")).toBe(false);
		expect(templateReferencesBases("const TMDB_BASE = 'https://api.themoviedb.org/3';")).toBe(false);
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

describe("Bases collection access", () => {
	it("keeps numeric access and uses the first safe named match for collisions", () => {
		const first = {
			source: { name: "Shared" },
			key: "FirstKey",
			name: "FirstView",
		};
		const second = {
			source: { name: "SecondSource" },
			key: "Shared",
			name: "SecondView",
		};

		const collection = buildBasesCollection([first, second]) as unknown[] & Record<string, unknown>;

		expect(collection[0]).toBe(first);
		expect(collection[1]).toBe(second);
		expect(collection.Shared).toBe(first);
		expect(collection.FirstKey).toBe(first);
		expect(collection.FirstView).toBe(first);
		expect(collection.SecondSource).toBe(second);
		expect(collection.SecondView).toBe(second);
	});

	it("does not attach unsafe prototype lookup keys", () => {
		const collection = buildBasesCollection([
			{ source: { name: "__proto__" }, key: "constructor", name: "prototype" },
		]) as unknown as Record<string, unknown>;

		expect(Object.prototype.hasOwnProperty.call(collection, "__proto__")).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(collection, "constructor")).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(collection, "prototype")).toBe(false);
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

	it("renders multiple template-defined Bases through named lookups", async () => {
		const app = makeMockApp();
		const file = makeMockFile();
		const container = window.document.createElement("div");
		const [songs] = makeBases({
			key: "Songs",
			name: "Table",
			sourceName: "Songs",
			rows: [{ basename: "Belinda Says", category: "Songs" }],
		});
		const [movies] = makeBases({
			key: "Movies",
			name: "Table",
			sourceName: "Movies",
			rows: [{ basename: "A Silent Voice", category: "Movies" }],
		});
		movies.source.index = 1;
		const getEmbeddedBases = vi.fn().mockResolvedValue([songs, movies]);
		const basesProvider: BasesDataProvider = {
			getEmbeddedBases,
		};
		const template = [
			"{% base \"Songs\" %}",
			"views:",
			"  - type: table",
			"    name: Table",
			"{% endbase %}",
			"{% base \"Movies\" %}",
			"views:",
			"  - type: table",
			"    name: Table",
			"{% endbase %}",
			"{% for row in bases.Songs.rows %}<span>{{row.file.basename}}</span>{% endfor %}",
			"{% for row in baseViews.Movies.rows %}<strong>{{row.file.basename}}</strong>{% endfor %}",
			"<em>{{bases[1].rowCount}}</em>",
			"<i>{{file.baseViews[0].source.name}}</i>",
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

		expect(container.textContent).toContain("Belinda Says");
		expect(container.textContent).toContain("A Silent Voice");
		expect(container.textContent).toContain("1");
		expect(container.textContent).toContain("Songs");
		expect(container.textContent).not.toContain("views:");
		expect(getEmbeddedBases).toHaveBeenCalledOnce();
	});

	it("resolves Bases references in view CSS and JavaScript fields", async () => {
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
		const viewConfig: ViewConfig = {
			id: "bases-css-js",
			name: "Bases CSS JS",
			rules: { type: "group", operator: "AND", conditions: [] },
			template: "",
			css: ".base-count::after { content: \"{{baseViews.Songs.rowCount}}\"; }",
			js: "this.dataset.baseCount = \"{{bases.Songs.rowCount}}\";",
		};

		await renderTemplate(
			app,
			"<div class=\"base-count\">{{file.basename}}</div>",
			file,
			container,
			new Component(),
			false,
			viewConfig,
			undefined,
			true,
			"```base\nviews: []\n```",
			basesProvider,
		);

		expect(container.querySelector("style")?.textContent).toContain('content: "1"');
		expect(container.dataset.baseCount).toBe("1");
		expect(getEmbeddedBases).toHaveBeenCalledOnce();
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

	it("does not collect Bases data when no Base sources exist", async () => {
		const app = makeMockApp();
		const file = makeMockFile();
		const container = window.document.createElement("div");
		const getEmbeddedBases = vi.fn().mockResolvedValue(makeBases());
		const basesProvider: BasesDataProvider = {
			getEmbeddedBases,
		};

		await renderTemplate(
			app,
			"<p>{{bases[0].rowCount}}</p>",
			file,
			container,
			new Component(),
			false,
			undefined,
			undefined,
			false,
			"# Plain note\nNo embedded base here.",
			basesProvider,
		);

		expect(container.textContent).toBe("");
		expect(getEmbeddedBases).not.toHaveBeenCalled();
	});
});

describe("EmbeddedBasesProvider", () => {
	it("evaluates Bases through a hidden native embed without registering a custom view type", async () => {
		let fakeFileContent = "";
		let selectedViewSubpath: string | undefined;
		const sourceContent = [
			"```base",
			JSON.stringify({
				views: [
					{ type: "table", name: "Songs" },
				],
			}),
			"```",
		].join("\n");
		const app = makeProviderApp({
			onReadFakeFile: (content, viewSubpath) => {
				fakeFileContent = content;
				selectedViewSubpath = viewSubpath;
			},
		});
		const cachedRead = vi.fn(async () => "");
		(app as unknown as { vault: { cachedRead: typeof cachedRead } }).vault.cachedRead = cachedRead;
		const plugin = makePlugin(app);
		const provider = new EmbeddedBasesProvider(plugin);
		const file = makeTFile({
			name: "Dashboard.md",
			basename: "Dashboard",
			path: "Dashboards/Dashboard.md",
			parent: { path: "Dashboards" },
		});

		expect(provider.register()).toBe(true);
		expect(plugin.registerBasesView).not.toHaveBeenCalled();

		const bases = await provider.getEmbeddedBases({
			app,
			file,
			templateContent: "{{bases[0].rowCount}}",
			sourceContent,
			ownerDocument: window.document,
			component: new Component(),
		});

		expect(cachedRead).not.toHaveBeenCalled();
		expect((app as unknown as { embedRegistry: { embedByExtension: { base: ReturnType<typeof vi.fn> } } })
			.embedRegistry.embedByExtension.base).toHaveBeenCalledOnce();
		expect(fakeFileContent).toContain("\"views\"");
		expect(selectedViewSubpath).toBe("#Songs");
		expect(bases).toHaveLength(1);
		expect(bases[0]).toMatchObject({
			name: "Songs",
			type: "table",
			rowCount: 1,
		});
		expect(bases[0].rows[0].values.categories).toBe("Songs");
		expect(window.document.body.querySelector(".cv-bases-collector-host")).toBeNull();
	});

	it("waits for native Base data after the collector queue first reports idle", async () => {
		vi.useFakeTimers();
		const sourceContent = [
			"```base",
			JSON.stringify({
				views: [
					{ type: "table", name: "Songs" },
				],
			}),
			"```",
		].join("\n");
		const app = makeProviderApp({
			delayViewMs: 50,
		});
		const provider = new EmbeddedBasesProvider(makePlugin(app));
		const file = makeTFile({
			name: "Dashboard.md",
			basename: "Dashboard",
			path: "Dashboards/Dashboard.md",
			parent: { path: "Dashboards" },
		});

		try {
			provider.register();
			const basesPromise = provider.getEmbeddedBases({
				app,
				file,
				templateContent: "{{bases[0].rowCount}}",
				sourceContent,
				ownerDocument: window.document,
				component: new Component(),
			});

			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(100);
			const bases = await basesPromise;

			expect(bases).toHaveLength(1);
			expect(bases[0].error).toBeUndefined();
			expect(bases[0].rowCount).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns an error view when Bases collection times out", async () => {
		vi.useFakeTimers();
		const baseConfig = JSON.stringify({
			views: [
				{ type: "table", name: "Songs" },
			],
		});
		const sourceContent = [
			"```base",
			baseConfig,
			"```",
		].join("\n");
		const app = makeProviderApp({
			sourceContent,
			neverFinish: true,
		});
		const provider = new EmbeddedBasesProvider(makePlugin(app));
		provider.register();
		const file = makeTFile({
			name: "Dashboard.md",
			basename: "Dashboard",
			path: "Dashboards/Dashboard.md",
			parent: { path: "Dashboards" },
		});

		try {
			const basesPromise = provider.getEmbeddedBases({
				app,
				file,
				templateContent: "{{bases[0].error}}",
				sourceContent,
				ownerDocument: window.document,
				component: new Component(),
			});
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(5000);
			const bases = await basesPromise;

			expect(bases).toHaveLength(1);
			expect(bases[0]).toMatchObject({
				name: "Songs",
				type: "table",
				source: {
					kind: "code-block",
					line: 1,
				},
				error: "Timed out while collecting Bases data.",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns an error view when an embedded .base file cannot be read", async () => {
		const app = makeProviderApp({
			sourceContent: "![[Songs.base]]",
		});
		const provider = new EmbeddedBasesProvider(makePlugin(app));
		provider.register();
		const file = makeTFile({
			name: "Dashboard.md",
			basename: "Dashboard",
			path: "Dashboards/Dashboard.md",
			parent: { path: "Dashboards" },
		});
		const baseFile = makeTFile({
			name: "Songs.base",
			basename: "Songs",
			path: "Dashboards/Songs.base",
			extension: "base",
			parent: { path: "Dashboards" },
		});
		const vault = (app as unknown as {
			vault: {
				getFileByPath: ReturnType<typeof vi.fn>;
				cachedRead: ReturnType<typeof vi.fn>;
			};
		}).vault;
		vault.getFileByPath.mockImplementation((path: string) => path === baseFile.path ? baseFile : null);
		vault.cachedRead.mockImplementation((target: TFile) => {
			if (target === file) return "![[Songs.base]]";
			throw new Error("Base file read failed");
		});

		const bases = await provider.getEmbeddedBases({
			app,
			file,
			templateContent: "{{bases[0].error}}",
			sourceContent: "![[Songs.base]]",
			ownerDocument: window.document,
			component: new Component(),
		});

		expect(bases).toHaveLength(1);
		expect(bases[0]).toMatchObject({
			name: "",
			source: {
				kind: "file-embed",
				path: baseFile.path,
			},
			error: "Base file read failed",
		});
	});
});
