/**
 * Tests for frontmatter.ts — stripping YAML frontmatter from raw file content.
 *
 * Run with:  npm test
 */
import { describe, it, expect } from "vitest";
import type { CachedMetadata } from "obsidian";
import { stripFrontmatter } from "../frontmatter";

describe("stripFrontmatter", () => {
	const fm = "---\nfoo: bar\n---";
	const raw = `${fm}\nworks fine i guess`;
	const offset = fm.length; // offset to the end of the closing `---`

	/** Build a minimal CachedMetadata with the official and/or legacy offset. */
	function makeCache(opts: { official?: number; legacy?: number }): CachedMetadata {
		const cache: CachedMetadata = {};
		if (opts.official !== undefined) {
			cache.frontmatterPosition = {
				start: { line: 0, col: 0, offset: 0 },
				end: { line: 2, col: 3, offset: opts.official },
			};
		}
		if (opts.legacy !== undefined) {
			// The legacy `position` is an undocumented property that older Obsidian
			// attached to the frontmatter object (FrontMatterCache is an open map).
			cache.frontmatter = { position: { end: { offset: opts.legacy } } };
		}
		return cache;
	}

	it("strips frontmatter using the official frontmatterPosition", () => {
		expect(stripFrontmatter(makeCache({ official: offset }), raw)).toBe("works fine i guess");
	});

	it("falls back to legacy frontmatter.position when frontmatterPosition is absent", () => {
		expect(stripFrontmatter(makeCache({ legacy: offset }), raw)).toBe("works fine i guess");
	});

	it("prefers the official offset over a bad legacy one", () => {
		// A legacy offset past the body would yield "" — the official offset must win.
		expect(stripFrontmatter(makeCache({ official: offset, legacy: raw.length }), raw)).toBe(
			"works fine i guess"
		);
	});

	it("returns the raw content unchanged when no offset is available", () => {
		expect(stripFrontmatter(makeCache({}), raw)).toBe(raw);
	});

	it("strips frontmatter from the raw text when a cached offset is stale", () => {
		const changedRaw = "---\ntitle: This changed after the metadata cache offset\n---\nbody";
		const staleOffset = "---\nt: old\n---".length;

		expect(stripFrontmatter(makeCache({ official: staleOffset }), changedRaw)).toBe("body");
	});

	it("strips frontmatter from the raw text when metadata has no offset", () => {
		const cache: CachedMetadata = { frontmatter: { foo: "bar" } };

		expect(stripFrontmatter(cache, raw)).toBe("works fine i guess");
	});

	it("does not apply a stale offset to content without YAML frontmatter", () => {
		expect(stripFrontmatter(makeCache({ official: 6 }), "body only")).toBe("body only");
	});

	it("does not trust an offset of 0 when the raw text has YAML frontmatter", () => {
		expect(stripFrontmatter(makeCache({ official: 0 }), raw)).toBe("works fine i guess");
	});

	it("returns the raw content when cache is null or undefined", () => {
		expect(stripFrontmatter(null, raw)).toBe(raw);
		expect(stripFrontmatter(undefined, raw)).toBe(raw);
	});

	it("handles an offset of 0 (no frontmatter) without treating it as missing", () => {
		expect(stripFrontmatter(makeCache({ official: 0 }), "body only")).toBe("body only");
	});
});
