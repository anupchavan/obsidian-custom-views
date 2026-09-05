import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { getVaultTemplateProperties } from "../template-properties";

describe("vault template property suggestions", () => {
	it("uses assigned native widgets without scanning vault files", () => {
		const scan = vi.fn(() => { throw new Error("Unexpected vault scan"); });
		const app = { metadataTypeManager: { getAllProperties: () => ({
			rating: { name: "Rating", widget: "number" },
			date: { name: "Date", widget: "text" },
			tags: { name: "tags", widget: "tags" },
			position: { name: "position", widget: "text" },
		}) }, vault: { getMarkdownFiles: scan } } as unknown as App;
		expect(getVaultTemplateProperties(app)).toEqual([
			{ name: "Date", type: "text" }, { name: "Rating", type: "number" }, { name: "tags", type: "list" },
		]);
		expect(scan).not.toHaveBeenCalled();
	});
	it("reads current registry values each time the dialog opens", () => {
		const properties = { status: { name: "status", widget: "text" } };
		const app = { metadataTypeManager: { getAllProperties: () => properties } } as unknown as App;
		expect(getVaultTemplateProperties(app)[0]?.type).toBe("text");
		properties.status.widget = "checkbox";
		expect(getVaultTemplateProperties(app)[0]?.type).toBe("checkbox");
	});
	it.each(["custom-widget", "constructor", "toString"])("handles an unknown widget %s without inheriting object members", widget => {
		const app = { metadataTypeManager: { getAllProperties: () => ({ item: { name: "item", widget } }) } } as unknown as App;
		expect(getVaultTemplateProperties(app)).toEqual([{ name: "item", type: "unknown" }]);
	});
	it("falls back to cached frontmatter and the actual assigned-widget API on older hosts", () => {
		const app = { metadataTypeManager: { getAssignedWidget: (name: string) => name === "date" ? "text" : null },
			vault: { getMarkdownFiles: () => ["one", "two"] },
			metadataCache: { getFileCache: (file: string) => ({ frontmatter: file === "one" ? { date: "2026-09-05", count: null } : { count: 0 } }) },
		} as unknown as App;
		expect(getVaultTemplateProperties(app)).toEqual([{ name: "count", type: "number" }, { name: "date", type: "text" }]);
	});
});
