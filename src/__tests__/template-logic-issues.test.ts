import { describe, expect, it, vi } from "vitest";
import { Component } from "obsidian";
import type { App, TFile } from "obsidian";
import { renderTemplate } from "../renderer";
import { folder } from "./folder";

const file = { name: "Spore Hero.md", basename: "Spore Hero", path: "Games/Spore Hero.md", extension: "md", stat: { size: 1, ctime: 1, mtime: 1 }, parent: folder("Games") } as unknown as TFile;

async function render(template: string, frontmatter: Record<string, unknown>): Promise<string> {
	const app = {
		metadataCache: { getFileCache: vi.fn().mockReturnValue({ frontmatter }), getFirstLinkpathDest: vi.fn().mockReturnValue(null) },
		vault: { cachedRead: vi.fn().mockResolvedValue("") },
	} as unknown as App;
	const container = window.document.createElement("div");
	await renderTemplate(app, template, file, container, new Component(), false, undefined, undefined, false, "");
	return container.textContent ?? "";
}

describe("template logic (issues #21 and #22)", () => {
	const game = { type: "game", status: "archived", rating: 1.3, archive_reason: "", title: "Spore Hero" };

	it("evaluates word operators and ?? as documented", async () => {
		const text = await render([
			'{% if status == "archived" and rating > 5 %}<p>F</p>{% endif %}',
			'{% if status == "archived" && rating > 5 %}<p>G</p>{% endif %}',
			'{% if status == "archived" or rating > 5 %}<p>O</p>{% endif %}',
			'{% if not archive_reason %}<p>H</p>{% endif %}',
			'{% if not status == "draft" %}<p>N</p>{% endif %}',
			"<h1>{{title ?? file.basename}}</h1><h2>{{subtitle ?? file.basename}}</h2>",
		].join(""), game);
		expect(text).toBe("OHNSpore HeroSpore Hero");
	});

	it("still reads and / or / not as property names after a dot", async () => {
		expect(await render("{{ flags.not ?? \"none\" }}|{{ flags.and }}", { flags: { not: "n", and: "a" } })).toBe("n|a");
	});

	it("keeps an outer if closed until its own endif", async () => {
		const template = '<dl>{% if status == "archived" %}<dt>Archived</dt><dd>{% if archive_reason %}{{archive_reason}}{% else %}no reason yet{% endif %}</dd>{% endif %}</dl>';
		expect(await render(template, { status: "", archive_reason: "" })).toBe("");
		expect(await render(template, { status: "archived", archive_reason: "" })).toBe("Archivedno reason yet");
		expect(await render(template, { status: "archived", archive_reason: "sold" })).toBe("Archivedsold");
	});
});
