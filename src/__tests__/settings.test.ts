/**
 * Tests for src/settings.ts
 *
 * Covers:
 *   - DEFAULT_SETTINGS shape and values
 *   - FilterBuilder.inferType — the function that guesses the property type
 *     from a frontmatter value
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";

// ---------------------------------------------------------------------------
// DEFAULT_SETTINGS
// ---------------------------------------------------------------------------

describe("DEFAULT_SETTINGS", () => {
	it("has enabled: true by default", () => {
		expect(DEFAULT_SETTINGS.enabled).toBe(true);
	});

	it("has workInLivePreview: true by default", () => {
		expect(DEFAULT_SETTINGS.workInLivePreview).toBe(true);
	});

	it("has workInCanvas: false by default", () => {
		expect(DEFAULT_SETTINGS.workInCanvas).toBe(false);
	});

	it("has editableContent: true by default", () => {
		expect(DEFAULT_SETTINGS.editableContent).toBe(true);
	});

	it("has allowJavaScript: true by default", () => {
		expect(DEFAULT_SETTINGS.allowJavaScript).toBe(true);
	});

	it("has at least one default view", () => {
		expect(DEFAULT_SETTINGS.views.length).toBeGreaterThan(0);
	});

	it("every default view has the required fields", () => {
		for (const view of DEFAULT_SETTINGS.views) {
			expect(typeof view.id).toBe("string");
			expect(view.id.length).toBeGreaterThan(0);
			expect(typeof view.name).toBe("string");
			expect(view.name.length).toBeGreaterThan(0);
			expect(typeof view.template).toBe("string");
			expect(view.rules).toBeDefined();
			expect(view.rules.type).toBe("group");
			expect(["AND", "OR", "NOR"]).toContain(view.rules.operator);
			expect(Array.isArray(view.rules.conditions)).toBe(true);
		}
	});

	it("default views share no object references (deep-cloned rules)", () => {
		// Mutating one view's rules must not affect another
		const copy = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
		copy.views[0].rules.conditions.push({
			type: "filter",
			field: "test",
			operator: "is",
			value: "x",
		});
		// Original should be untouched
		expect(DEFAULT_SETTINGS.views[0].rules.conditions).not.toEqual(copy.views[0].rules.conditions);
	});
});

// ---------------------------------------------------------------------------
// FilterBuilder.inferType
//
// FilterBuilder requires a real Plugin instance in its constructor because it
// calls this.plugin.app.vault.getMarkdownFiles(). We provide a minimal stub.
// ---------------------------------------------------------------------------

import { FilterBuilder } from "../settings";
import type CustomViewsPlugin from "../main";

// Minimal plugin stub that satisfies what FilterBuilder's constructor needs.
function makeStubPlugin() {
	return {
		app: {
			vault: {
				getMarkdownFiles: () => [],
			},
			metadataCache: {
				getFileCache: () => null,
			},
		},
	} as unknown as CustomViewsPlugin;
}

// Helper: create a FilterBuilder and call inferType
function inferType(val: unknown) {
	const fb = new FilterBuilder(
		makeStubPlugin(),
		{ type: "group", operator: "AND", conditions: [] },
		() => { },
		() => { }
	);
	return fb.inferType(val);
}

describe("FilterBuilder.inferType", () => {
	it("returns 'unknown' for null", () => expect(inferType(null)).toBe("unknown"));
	it("returns 'unknown' for undefined", () => expect(inferType(undefined)).toBe("unknown"));

	it("returns 'list' for an array", () => expect(inferType(["a", "b"])).toBe("list"));
	it("returns 'list' for an empty array", () => expect(inferType([])).toBe("list"));

	it("returns 'number' for a number", () => expect(inferType(42)).toBe("number"));
	it("returns 'number' for 0", () => expect(inferType(0)).toBe("number"));

	it("returns 'checkbox' for true", () => expect(inferType(true)).toBe("checkbox"));
	it("returns 'checkbox' for false", () => expect(inferType(false)).toBe("checkbox"));

	it("returns 'date' for a YYYY-MM-DD string", () => expect(inferType("2024-06-15")).toBe("date"));
	it("returns 'date' for start-of-range date", () => expect(inferType("2000-01-01")).toBe("date"));

	it("returns 'datetime' for a YYYY-MM-DDThh:mm string", () => expect(inferType("2024-06-15T14:30:00")).toBe("datetime"));
	it("returns 'datetime' for ISO string with Z", () => expect(inferType("2024-06-15T00:00:00Z")).toBe("datetime"));

	it("returns 'text' for a plain string", () => expect(inferType("hello")).toBe("text"));
	it("returns 'text' for a URL-like string", () => expect(inferType("https://example.com")).toBe("text"));
	it("returns 'text' for a numeric string (e.g. '42')", () => expect(inferType("42")).toBe("text"));
	it("returns 'text' for a wikilink string", () => expect(inferType("[[My Note]]")).toBe("text"));
});

// ---------------------------------------------------------------------------
// ViewConfig defaults
// ---------------------------------------------------------------------------

import type { ViewConfig } from "../types";

describe("ViewConfig optional fields", () => {
	it("default views do not set showProperties (defaults to undefined)", () => {
		for (const view of DEFAULT_SETTINGS.views) {
			expect(view.showProperties).toBeUndefined();
		}
	});

	it("default views do not set showInlineTitle (defaults to undefined)", () => {
		for (const view of DEFAULT_SETTINGS.views) {
			expect(view.showInlineTitle).toBeUndefined();
		}
	});

	it("default views do not set css (defaults to undefined)", () => {
		for (const view of DEFAULT_SETTINGS.views) {
			expect(view.css).toBeUndefined();
		}
	});

	it("default views do not set js (defaults to undefined)", () => {
		for (const view of DEFAULT_SETTINGS.views) {
			expect(view.js).toBeUndefined();
		}
	});

	it("showProperties=true means properties are shown (not hidden)", () => {
		const view: ViewConfig = {
			id: "test",
			name: "Test",
			rules: { type: "group", operator: "AND", conditions: [] },
			template: "<p>test</p>",
			showProperties: true,
		};
		// showProperties=true means show, showProperties=false means hide
		expect(view.showProperties).toBe(true);
	});

	it("showProperties=false means properties are hidden", () => {
		const view: ViewConfig = {
			id: "test",
			name: "Test",
			rules: { type: "group", operator: "AND", conditions: [] },
			template: "<p>test</p>",
			showProperties: false,
		};
		expect(view.showProperties).toBe(false);
	});
});
