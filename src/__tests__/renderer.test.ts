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
import { describe, it, expect, vi } from "vitest";
import {
	templateHasEditableContent,
	findFirstPipe,
	resultToString,
	parsePropertyPath,
	extractWikiLink,
	renderTemplate,
} from "../renderer";
import { Component, MarkdownRenderer, TFile } from "obsidian";
import type { App } from "obsidian";

function renderTestWikilinks(markdown: string): Node[] {
	const nodes: Node[] = [];
	const re = /\[\[([^\]\n]+)\]\]/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = re.exec(markdown)) !== null) {
		if (match.index > lastIndex) {
			nodes.push(window.document.createTextNode(markdown.slice(lastIndex, match.index)));
		}

		const [target, display] = match[1].split("|", 2);
		const link = window.document.createElement("a");
		link.classList.add("internal-link");
		link.setAttribute("data-href", target);
		link.setAttribute("href", target);
		link.textContent = display ?? target;
		nodes.push(link);
		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < markdown.length) {
		nodes.push(window.document.createTextNode(markdown.slice(lastIndex)));
	}

	return nodes;
}

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

	it("handles quoted keys with slashes", () => {
		expect(parsePropertyPath('"book/title"')).toEqual([{ key: "book/title" }]);
	});

	it("handles bracket-quoted keys with slashes", () => {
		expect(parsePropertyPath('["book/title"]')).toEqual([{ key: "book/title" }]);
	});

	it("handles bracket-quoted keys with array indices", () => {
		expect(parsePropertyPath('["book/title"][1]')).toEqual([
			{ key: "book/title", index: 1 },
		]);
	});

	it("does not split dots inside bracket-quoted keys", () => {
		expect(parsePropertyPath('["book.title"].subtitle')).toEqual([
			{ key: "book.title" },
			{ key: "subtitle" },
		]);
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

// ---------------------------------------------------------------------------
// renderTemplate source content
// ---------------------------------------------------------------------------

describe("renderTemplate source content", () => {
	it("uses already-loaded source content instead of reading the file", async () => {
		const read = vi.fn(async () => {
			throw new Error("vault.read should not be called");
		});
		const cachedRead = vi.fn(async () => {
			throw new Error("vault.cachedRead should not be called");
		});
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => null),
			},
			vault: {
				read,
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Movies/Test.md";
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const container = doc.createElement("div");

		await renderTemplate(
			app,
			"<article>{{content | upper}}</article>",
			file,
			container,
			component,
			false,
			undefined,
			undefined,
			false,
			"Already loaded from the active view",
		);

		expect(read).not.toHaveBeenCalled();
		expect(cachedRead).not.toHaveBeenCalled();
		expect(container.textContent).toBe("ALREADY LOADED FROM THE ACTIVE VIEW");
	});

	it("uses cachedRead instead of direct vault read when source content is unavailable", async () => {
		const read = vi.fn(async () => {
			throw new Error("vault.read should not be called");
		});
		const cachedRead = vi.fn(async () => "Cached body");
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => null),
			},
			vault: {
				read,
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Music/Pink Blue.md";
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const container = doc.createElement("div");

		await renderTemplate(
			app,
			"<article>{{content | upper}}</article>",
			file,
			container,
			component,
			false,
			undefined,
			undefined,
			false,
		);

		expect(cachedRead).toHaveBeenCalledWith(file);
		expect(read).not.toHaveBeenCalled();
		expect(container.textContent).toBe("CACHED BODY");
	});

	it("reuses cached source content while the file stat is unchanged", async () => {
		const cachedRead = vi.fn(async () => "Cached body");
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => null),
			},
			vault: {
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Movies/Cached Source.md";
		file.stat = { ctime: 0, mtime: 100, size: 11 };
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const firstContainer = doc.createElement("div");
		const secondContainer = doc.createElement("div");

		await renderTemplate(
			app,
			"<article>{{content | upper}}</article>",
			file,
			firstContainer,
			component,
			false,
			undefined,
			undefined,
			false,
		);
		await renderTemplate(
			app,
			"<article>{{content | upper}}</article>",
			file,
			secondContainer,
			component,
			false,
			undefined,
			undefined,
			false,
		);

		expect(cachedRead).toHaveBeenCalledTimes(1);
		expect(firstContainer.textContent).toBe("CACHED BODY");
		expect(secondContainer.textContent).toBe("CACHED BODY");
	});

	it("refreshes cached source content when the file stat changes", async () => {
		const cachedRead = vi.fn()
			.mockResolvedValueOnce("First body")
			.mockResolvedValueOnce("Second body");
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => null),
			},
			vault: {
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Movies/Changing Source.md";
		file.stat = { ctime: 0, mtime: 100, size: 10 };
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const firstContainer = doc.createElement("div");
		const secondContainer = doc.createElement("div");

		await renderTemplate(
			app,
			"<article>{{content | upper}}</article>",
			file,
			firstContainer,
			component,
			false,
			undefined,
			undefined,
			false,
		);

		file.stat = { ctime: 0, mtime: 101, size: 11 };

		await renderTemplate(
			app,
			"<article>{{content | upper}}</article>",
			file,
			secondContainer,
			component,
			false,
			undefined,
			undefined,
			false,
		);

		expect(cachedRead).toHaveBeenCalledTimes(2);
		expect(firstContainer.textContent).toBe("FIRST BODY");
		expect(secondContainer.textContent).toBe("SECOND BODY");
	});

	it("renders plain placeholder values without MarkdownRenderer", async () => {
		const cachedRead = vi.fn(async () => "Body");
		const renderSpy = vi.spyOn(MarkdownRenderer, "render");
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => ({
					frontmatter: {
						title: "Tom \"Jerry\" 'Best'",
					},
				})),
			},
			vault: {
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Movies/Test.md";
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const container = doc.createElement("div");

		try {
			await renderTemplate(
				app,
				"<p>{{title}}</p>",
				file,
				container,
				component,
				false,
				undefined,
				undefined,
				false,
			);
		} finally {
			renderSpy.mockRestore();
		}

		expect(container.textContent).toBe("Tom \"Jerry\" 'Best'");
		expect(renderSpy).not.toHaveBeenCalled();
	});

	it("renders markdown placeholders after text apostrophes", async () => {
		const cachedRead = vi.fn(async () => "Body");
		const renderedMarkdown: string[] = [];
		const renderSpy = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (
			_app: unknown,
			markdown: string,
			el: HTMLElement,
		) => {
			renderedMarkdown.push(markdown);
			const img = el.ownerDocument.createElement("img");
			img.className = "rendered-image";
			img.setAttribute("src", markdown.match(/\((?:<([^>]+)>|([^)]+))\)/)?.[1] ?? "");
			el.appendChild(img);
		});
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => ({
					frontmatter: {
						photo: "test 1.png",
					},
				})),
			},
			vault: {
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Issue 12/Test.md";
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const container = doc.createElement("div");

		try {
			await renderTemplate(
				app,
				'<div>What\'s New</div>{{image(photo)}}<img class="raw-image" src="{{photo}}">',
				file,
				container,
				component,
				false,
				undefined,
				undefined,
				false,
			);
		} finally {
			renderSpy.mockRestore();
		}

		expect(renderedMarkdown).toEqual(["![](<test 1.png>)"]);
		expect(container.querySelector(".rendered-image")?.getAttribute("src")).toBe("test 1.png");
		expect(container.querySelector(".raw-image")?.getAttribute("src")).toBe("test 1.png");
	});

	it("marks unresolved state on rendered internal links", async () => {
		const cachedRead = vi.fn(async () => "Body");
		const renderedMarkdown: string[] = [];
		const existingFile = new TFile();
		existingFile.path = "Movies.md";
		const renderSpy = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (
			_app: unknown,
			markdown: string,
			el: HTMLElement,
		) => {
			renderedMarkdown.push(markdown);
			el.replaceChildren(...renderTestWikilinks(markdown));
		});
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => ({
					frontmatter: {
						existing: "[[Movies]]",
						missing: ["[[Songs]]", "[[Music Videos]]"],
					},
				})),
				getFirstLinkpathDest: vi.fn((target: string) => target === "Movies" ? existingFile : null),
			},
			vault: {
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Books/Test.md";
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const container = doc.createElement("div");

		try {
			await renderTemplate(
				app,
				"<p>{{existing}}</p><span>{{missing}}</span>",
				file,
				container,
				component,
				false,
				undefined,
				undefined,
				false,
			);
		} finally {
			renderSpy.mockRestore();
		}

		expect(renderedMarkdown).toEqual([
			"[[Movies]]",
			"[[Songs]], [[Music Videos]]",
		]);
			expect(container.querySelector('[data-href="Movies"]')?.classList.contains("is-unresolved")).toBe(false);
			expect(container.querySelector('[data-href="Songs"]')?.classList.contains("is-unresolved")).toBe(true);
			expect(container.querySelector('[data-href="Music Videos"]')?.classList.contains("is-unresolved")).toBe(true);
		});

	it("resolves quoted frontmatter keys that contain slashes", async () => {
		const cachedRead = vi.fn(async () => "Body");
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => ({
					frontmatter: {
						"book/title": "The book",
						"book/series": ["First", "Second"],
					},
				})),
			},
			vault: {
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Books/Test.md";
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const container = doc.createElement("div");

		await renderTemplate(
			app,
			'<p>{{["book/title"]}}</p><p>{{"book/title" | upper}}</p><p>{{["book/series"][1]}}</p>',
			file,
			container,
			component,
			false,
			undefined,
			undefined,
			false,
		);

		expect(container.textContent).toBe("The bookTHE BOOKSecond");
	});

	it("resolves unquoted frontmatter keys that contain slashes", async () => {
		const cachedRead = vi.fn(async () => "Body");
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => ({
					frontmatter: {
						"book/title": "The book",
					},
				})),
			},
			vault: {
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Books/Test.md";
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const container = doc.createElement("div");

		await renderTemplate(
			app,
			"<p>{{book/title}}</p><p>{{book/title | upper}}</p>",
			file,
			container,
			component,
			false,
			undefined,
			undefined,
			false,
		);

		expect(container.textContent).toBe("The bookTHE BOOK");
	});

	it("keeps division expressions working when no matching slash key exists", async () => {
		const cachedRead = vi.fn(async () => "Body");
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => ({ frontmatter: {} })),
			},
			vault: {
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Books/Test.md";
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const container = doc.createElement("div");

		await renderTemplate(
			app,
			"{{10 / 2}}",
			file,
			container,
			component,
			false,
			undefined,
			undefined,
			false,
		);

		expect(container.textContent).toBe("5");
	});

	it("uses slash frontmatter keys inside larger arithmetic expressions when the key exists", async () => {
		const cachedRead = vi.fn(async () => "Body");
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => ({
					frontmatter: {
						"book/title": 20,
					},
				})),
			},
			vault: {
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Books/Test.md";
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const container = doc.createElement("div");

		await renderTemplate(
			app,
			"{{book/title + 10/2}}",
			file,
			container,
			component,
			false,
			undefined,
			undefined,
			false,
		);

		expect(container.textContent).toBe("25");
	});

	it("uses normal division in larger slash expressions when no matching slash key exists", async () => {
		const cachedRead = vi.fn(async () => "Body");
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => ({
					frontmatter: {
						book: 20,
						title: 4,
					},
				})),
			},
			vault: {
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Books/Test.md";
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const container = doc.createElement("div");

		await renderTemplate(
			app,
			"{{book/title + 10/2}}",
			file,
			container,
			component,
			false,
			undefined,
			undefined,
			false,
		);

		expect(container.textContent).toBe("10");
	});

	it("prefers existing slash keys over division when both interpretations are possible", async () => {
		const cachedRead = vi.fn(async () => "Body");
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => ({
					frontmatter: {
						"book/title": 20,
						book: 100,
						title: 10,
					},
				})),
			},
			vault: {
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Books/Test.md";
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const container = doc.createElement("div");

		await renderTemplate(
			app,
			"{{book/title + 10/2}}",
			file,
			container,
			component,
			false,
			undefined,
			undefined,
			false,
		);

		expect(container.textContent).toBe("25");
	});

	it("keeps quoted slash strings as literals when no matching frontmatter key exists", async () => {
		const cachedRead = vi.fn(async () => "Body");
		const app = {
			metadataCache: {
				getFileCache: vi.fn(() => ({ frontmatter: {} })),
			},
			vault: {
				cachedRead,
			},
		} as unknown as App;
		const file = new TFile();
		file.path = "Books/Test.md";
		const component = new Component();
		const doc = new DOMParser().parseFromString("<main></main>", "text/html");
		const container = doc.createElement("div");

		await renderTemplate(
			app,
			'{{"https://example.com/cover.jpg"}}',
			file,
			container,
			component,
			false,
			undefined,
			undefined,
			false,
		);

		expect(container.textContent).toBe("https://example.com/cover.jpg");
	});
});
