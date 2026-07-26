import { describe, it, expect, beforeAll } from "vitest";
import { renderTemplate } from "../templateRenderer";
import type { App, TFile, Component } from "obsidian";

// activeDocument is an Obsidian global used inside renderTemplate
beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).activeDocument = document;
    // Polyfill Obsidian's HTMLElement extensions used by renderTemplate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(HTMLElement.prototype as any).addClass) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (HTMLElement.prototype as any).addClass = function (...cls: string[]) {
            this.classList.add(...cls);
        };
    }
});

function makeApp(opts: {
    frontmatter?: Record<string, unknown>;
    fileContent?: string;
} = {}) {
    return {
        metadataCache: {
            getFileCache: () => opts.frontmatter !== undefined ? { frontmatter: opts.frontmatter } : null,
        },
        vault: { read: async () => opts.fileContent ?? "" },
    } as unknown as App;
}

function makeFile(opts: {
    name?: string;
    basename?: string;
    path?: string;
    extension?: string;
    parent?: { path: string } | null;
    stat?: { size: number; ctime: number; mtime: number };
} = {}) {
    return {
        name: opts.name ?? "note.md",
        basename: opts.basename ?? "note",
        path: opts.path ?? "note.md",
        extension: opts.extension ?? "md",
        parent: opts.parent !== undefined ? opts.parent : { path: "folder" },
        stat: opts.stat ?? { size: 100, ctime: 0, mtime: 0 },
    } as unknown as TFile;
}

async function render(template: string, file?: TFile, frontmatter?: Record<string, unknown>) {
    const container = document.createElement("div");
    await renderTemplate(
        makeApp({ frontmatter }),
        template,
        file ?? makeFile(),
        container,
        {} as unknown as Component
    );
    return container;
}

// ---------------------------------------------------------------------------
// Attribute-injected values (inlined as raw strings — no MarkdownRenderer)
// ---------------------------------------------------------------------------

describe("file property variables (attribute injection)", () => {
    it("{{file.basename}} resolves to file basename", async () => {
        const el = await render('<img alt="{{file.basename}}">', makeFile({ basename: "my-note" }));
        expect(el.querySelector("img")?.getAttribute("alt")).toBe("my-note");
    });

    it("{{file.name}} resolves to file name", async () => {
        const el = await render('<img alt="{{file.name}}">', makeFile({ name: "my-note.md" }));
        expect(el.querySelector("img")?.getAttribute("alt")).toBe("my-note.md");
    });

    it("{{file.path}} resolves to full file path", async () => {
        const el = await render('<img src="{{file.path}}">', makeFile({ path: "folder/sub/note.md" }));
        expect(el.querySelector("img")?.getAttribute("src")).toBe("folder/sub/note.md");
    });

    it("{{file.folder}} resolves to parent folder path", async () => {
        const el = await render('<img alt="{{file.folder}}">', makeFile({ parent: { path: "projects/work" } }));
        expect(el.querySelector("img")?.getAttribute("alt")).toBe("projects/work");
    });

    it("{{file.extension}} resolves to file extension", async () => {
        const el = await render('<img alt="{{file.extension}}">', makeFile({ extension: "md" }));
        expect(el.querySelector("img")?.getAttribute("alt")).toBe("md");
    });

    it("{{file.size}} resolves to file size", async () => {
        const el = await render('<img alt="{{file.size}}">', makeFile({ stat: { size: 4096, ctime: 0, mtime: 0 } }));
        expect(el.querySelector("img")?.getAttribute("alt")).toBe("4096");
    });

    it("{{file.folder}} is empty string when file is in vault root", async () => {
        const el = await render('<img alt="{{file.folder}}">', makeFile({ parent: { path: "" } }));
        expect(el.querySelector("img")?.getAttribute("alt")).toBe("");
    });
});

// ---------------------------------------------------------------------------
// Frontmatter variable resolution
// ---------------------------------------------------------------------------

describe("frontmatter variables (attribute injection)", () => {
    it("resolves a frontmatter string property", async () => {
        const el = await render('<div class="{{status}}">', makeFile(), { status: "done" });
        expect(el.querySelector("div")?.getAttribute("class")).toBe("done");
    });

    it("renders empty string for a missing frontmatter property", async () => {
        const el = await render('<div class="{{missing}}">', makeFile(), { status: "done" });
        expect(el.querySelector("div")?.getAttribute("class")).toBe("");
    });

    it("renders empty string when there is no frontmatter at all", async () => {
        const el = await render('<div class="{{anything}}">');
        expect(el.querySelector("div")?.getAttribute("class")).toBe("");
    });
});

// ---------------------------------------------------------------------------
// Frontmatter must NOT override known file.* properties (issue #1 / #4 fix)
// ---------------------------------------------------------------------------

describe("file.* properties take priority over frontmatter (bug fix)", () => {
    it("{{file.path}} returns file.path, not a 'path' frontmatter key", async () => {
        const el = await render(
            '<img src="{{file.path}}">',
            makeFile({ path: "real/path/note.md" }),
            { path: "frontmatter-path" }
        );
        expect(el.querySelector("img")?.getAttribute("src")).toBe("real/path/note.md");
    });

    it("{{file.basename}} is not overridden by a frontmatter 'basename' key", async () => {
        const el = await render(
            '<img alt="{{file.basename}}">',
            makeFile({ basename: "real-basename" }),
            { basename: "fm-basename" }
        );
        expect(el.querySelector("img")?.getAttribute("alt")).toBe("real-basename");
    });

    it("bare {{path}} resolves from frontmatter when available", async () => {
        const el = await render('<img src="{{path}}">', makeFile(), { path: "fm-path-value" });
        expect(el.querySelector("img")?.getAttribute("src")).toBe("fm-path-value");
    });
});

// ---------------------------------------------------------------------------
// Filter chains on attribute-injected values
// ---------------------------------------------------------------------------

describe("filter chains in templates", () => {
    it("applies a single filter", async () => {
        const el = await render('<img alt="{{file.basename|upper}}">', makeFile({ basename: "hello" }));
        expect(el.querySelector("img")?.getAttribute("alt")).toBe("HELLO");
    });

    it("applies a chained filter", async () => {
        // upper→kebab: "In Progress" → "IN PROGRESS" → "in-progress" (kebab lowercases)
        const el = await render('<span class="{{status|upper|kebab}}">', makeFile(), { status: "In Progress" });
        expect(el.querySelector("span")?.getAttribute("class")).toBe("in-progress");
    });

    it("applies date filter to a timestamp", async () => {
        const ts = new Date("2024-06-15T12:00:00Z").getTime();
        const el = await render('<img alt="{{file.ctime|date}}">', makeFile({ stat: { size: 0, ctime: ts, mtime: 0 } }));
        // result is a YYYY-MM-DD string; exact value depends on local timezone
        expect(el.querySelector("img")?.getAttribute("alt")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

// ---------------------------------------------------------------------------
// Non-attribute values — rendered via MarkdownRenderer (mock sets textContent)
// ---------------------------------------------------------------------------

describe("non-attribute variable rendering", () => {
    it("renders a non-attribute variable as markdown", async () => {
        const el = await render("<p>{{file.basename}}</p>", makeFile({ basename: "My Note" }));
        // MarkdownRenderer mock puts the value as textContent of a span inside <p>
        expect(el.querySelector("p")?.textContent?.trim()).toBe("My Note");
    });

    it("renders a frontmatter value inline", async () => {
        const el = await render("<p>{{status}}</p>", makeFile(), { status: "active" });
        expect(el.querySelector("p")?.textContent?.trim()).toBe("active");
    });
});

// ---------------------------------------------------------------------------
// {{file.content}} — inserts a placeholder div for body content
// ---------------------------------------------------------------------------

describe("{{file.content}} placeholder", () => {
    it("inserts a rendered-content div for {{file.content}}", async () => {
        const el = await render("<main>{{file.content}}</main>", makeFile(), undefined);
        // The placeholder div has class markdown-rendered-content
        expect(el.querySelector(".markdown-rendered-content")).toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// Inline <script> execution
// ---------------------------------------------------------------------------

describe("template scripts", () => {
    it("executes an inline script with `this` bound to the render container", async () => {
        const el = await render("<div><script>this.setAttribute('data-executed', 'yes');</script></div>");
        expect(el.getAttribute("data-executed")).toBe("yes");
    });

    it("removes the script element after executing it", async () => {
        const el = await render("<div><script>void 0;</script></div>");
        expect(el.querySelector("script")).toBeNull();
    });

    it("does not execute a script with a src attribute", async () => {
        const el = await render('<div><script src="https://example.com/evil.js">this.setAttribute(\'data-executed\', \'yes\')</script></div>');
        expect(el.getAttribute("data-executed")).toBeNull();
        expect(el.querySelector("script")).toBeNull();
    });

    it("swallows errors thrown by a template script instead of crashing the render", async () => {
        const el = await render("<div><div id=\"marker\"></div><script>throw new Error('boom');</script></div>");
        expect(el.querySelector("#marker")).toBeTruthy();
        expect(el.querySelector("script")).toBeNull();
    });
});
