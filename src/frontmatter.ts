import type { CachedMetadata } from "obsidian";

function getFrontmatterEndOffset(cache: CachedMetadata | null | undefined): number | undefined {
	// Older Obsidian attached the frontmatter range to the frontmatter object as
	// an undocumented `position`; current Obsidian exposes it as the official
	// `frontmatterPosition`. Type the legacy shape explicitly so neither path
	// needs `any`.
	const legacyFrontmatter = cache?.frontmatter as
		| { position?: { end?: { offset?: number } } }
		| undefined;
	return cache?.frontmatterPosition?.end?.offset ?? legacyFrontmatter?.position?.end?.offset;
}

function hasFrontmatter(cache: CachedMetadata | null | undefined): boolean {
	return Boolean(cache?.frontmatterPosition || cache?.frontmatter);
}

function startsWithYamlFrontmatter(raw: string): boolean {
	return raw.startsWith("---\n") || raw.startsWith("---\r\n");
}

function isOffsetForThisContent(raw: string, offset: number): boolean {
	const hasYamlMarker = startsWithYamlFrontmatter(raw);
	if (offset === 0) return !hasYamlMarker;
	if (offset < 0 || offset > raw.length || !hasYamlMarker) return false;

	const firstLineEnd = raw.indexOf("\n");
	if (firstLineEnd === -1 || offset <= firstLineEnd) return false;

	const beforeOffset = raw.slice(0, offset).trimEnd();
	return beforeOffset.endsWith("\n---");
}

function findYamlFrontmatterEndOffset(raw: string): number | undefined {
	if (!startsWithYamlFrontmatter(raw)) return undefined;

	let lineStart = raw.indexOf("\n") + 1;
	while (lineStart < raw.length) {
		let lineEnd = raw.indexOf("\n", lineStart);
		if (lineEnd === -1) lineEnd = raw.length;

		const line = raw.slice(lineStart, lineEnd).replace(/\r$/, "");
		if (line === "---") return lineEnd;

		lineStart = lineEnd + 1;
	}

	return undefined;
}

/**
 * Strip the YAML frontmatter from a file's raw content, returning just the body.
 *
 * Prefers the official `cache.frontmatterPosition` (Obsidian ≥ 1.4); falls back
 * to the legacy `frontmatter.position` only for older versions. If Obsidian's
 * cached offset does not match this exact raw string, re-detect the closing YAML
 * marker from the raw string itself before stripping. This keeps active-view
 * content and metadata-cache timing from slicing into the middle of frontmatter.
 */
export function stripFrontmatter(cache: CachedMetadata | null | undefined, raw: string): string {
	const endOffset = getFrontmatterEndOffset(cache);
	if (typeof endOffset === "number" && isOffsetForThisContent(raw, endOffset)) {
		return raw.substring(endOffset).trim();
	}

	if (hasFrontmatter(cache)) {
		const parsedOffset = findYamlFrontmatterEndOffset(raw);
		if (typeof parsedOffset === "number") {
			return raw.substring(parsedOffset).trim();
		}
	}

	return raw;
}
