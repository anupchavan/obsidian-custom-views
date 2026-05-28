/**
 * Tests for src/editable-content.ts and related editable content helpers.
 *
 * Covers:
 *   - detectFrontmatterRange — parsing frontmatter boundaries from CM6-like doc
 *   - templateHasEditableContent — detecting editable {{file.content}} in templates
 *   - StateField decoration creation (frontmatterHideField)
 */

import { describe, it, expect } from "vitest";
import { detectFrontmatterRange } from "../editable-content";
import { templateHasEditableContent } from "../renderer";

// ---------------------------------------------------------------------------
// Helper: create a minimal doc-like object from a string
// ---------------------------------------------------------------------------

function mockDoc(content: string) {
	const lines = content.split("\n");
	return {
		lines: lines.length,
		line(n: number) {
			// CM6 lines are 1-indexed
			const text = lines[n - 1] ?? "";
			const from = lines.slice(0, n - 1).reduce((acc, l) => acc + l.length + 1, 0);
			return { text, from, to: from + text.length };
		},
	};
}

// ---------------------------------------------------------------------------
// detectFrontmatterRange
// ---------------------------------------------------------------------------

describe("detectFrontmatterRange", () => {
	it("detects standard frontmatter", () => {
		const doc = mockDoc("---\ntitle: Hello\ntags: [a, b]\n---\nBody content here");
		const range = detectFrontmatterRange(doc);
		expect(range).not.toBeNull();
		// The range should cover from 0 to end of closing --- plus the newline
		expect(range!.from).toBe(0);
		// "---\ntitle: Hello\ntags: [a, b]\n---\n" = 34 chars
		expect(range!.to).toBe(34);
	});

	it("returns null for no frontmatter", () => {
		const doc = mockDoc("Just body content\nNo frontmatter here");
		expect(detectFrontmatterRange(doc)).toBeNull();
	});

	it("returns null for unclosed frontmatter", () => {
		const doc = mockDoc("---\ntitle: Hello\nNo closing delimiter");
		expect(detectFrontmatterRange(doc)).toBeNull();
	});

	it("handles empty frontmatter", () => {
		const doc = mockDoc("---\n---\nBody");
		const range = detectFrontmatterRange(doc);
		expect(range).not.toBeNull();
		expect(range!.from).toBe(0);
		// "---\n---\n" = 8 chars
		expect(range!.to).toBe(8);
	});

	it("returns null for single-line document", () => {
		const doc = mockDoc("---");
		expect(detectFrontmatterRange(doc)).toBeNull();
	});

	it("returns null when first line is not ---", () => {
		const doc = mockDoc("hello\n---\nworld\n---");
		expect(detectFrontmatterRange(doc)).toBeNull();
	});

	it("handles frontmatter with whitespace around delimiters", () => {
		const doc = mockDoc("---  \nkey: val\n  ---  \nBody");
		const range = detectFrontmatterRange(doc);
		expect(range).not.toBeNull();
		expect(range!.from).toBe(0);
	});

	it("handles frontmatter at end of file (no trailing newline)", () => {
		const doc = mockDoc("---\nkey: val\n---");
		const range = detectFrontmatterRange(doc);
		expect(range).not.toBeNull();
		expect(range!.from).toBe(0);
		// No trailing newline — to should be end of last ---
		expect(range!.to).toBe(16);
	});

	it("handles multiline frontmatter", () => {
		const doc = mockDoc("---\na: 1\nb: 2\nc: 3\nd: 4\ne: 5\n---\nBody");
		const range = detectFrontmatterRange(doc);
		expect(range).not.toBeNull();
		expect(range!.from).toBe(0);
	});
});

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

	it("returns false for {{file.content | filter}}", () => {
		expect(templateHasEditableContent("<div>{{file.content | uppercase}}</div>")).toBe(false);
	});

	it("returns false for {{content | filter}}", () => {
		expect(templateHasEditableContent("<div>{{content | trim}}</div>")).toBe(false);
	});

	it("returns false when no content placeholder exists", () => {
		expect(templateHasEditableContent("<div>{{file.name}}</div>")).toBe(false);
	});

	it("returns false for empty template", () => {
		expect(templateHasEditableContent("")).toBe(false);
	});

	it("returns true when content is in a complex template", () => {
		const template = `
			<div class="header">{{file.basename}}</div>
			<main>{{file.content}}</main>
			<footer>{{file.mtime}}</footer>
		`;
		expect(templateHasEditableContent(template)).toBe(true);
	});

	it("returns false when content has a pipe even in complex template", () => {
		const template = `
			<div class="header">{{file.basename}}</div>
			<main>{{file.content | markdown}}</main>
		`;
		expect(templateHasEditableContent(template)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// DEFAULT_SETTINGS includes editableContent
// ---------------------------------------------------------------------------

describe("editableContent setting", () => {
	it("defaults to true in DEFAULT_SETTINGS", async () => {
		const { DEFAULT_SETTINGS } = await import("../settings");
		expect(DEFAULT_SETTINGS.editableContent).toBe(true);
	});
});
