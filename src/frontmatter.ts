import type { CachedMetadata } from "obsidian";

/**
 * Strip the YAML frontmatter from a file's raw content, returning just the body.
 *
 * Prefers the official `cache.frontmatterPosition` (Obsidian ≥ 1.4); falls back
 * to the legacy `frontmatter.position` only for older versions. Earlier code
 * relied solely on the legacy property, which current Obsidian no longer
 * populates — so the offset was always `undefined` and the raw YAML leaked into
 * `{{file.content}}` instead of being stripped.
 */
export function stripFrontmatter(cache: CachedMetadata | null | undefined, raw: string): string {
	// Older Obsidian attached the frontmatter range to the frontmatter object as
	// an undocumented `position`; current Obsidian exposes it as the official
	// `frontmatterPosition`. Type the legacy shape explicitly so neither path
	// needs `any`.
	const legacyFrontmatter = cache?.frontmatter as
		| { position?: { end?: { offset?: number } } }
		| undefined;
	const endOffset =
		cache?.frontmatterPosition?.end?.offset ?? legacyFrontmatter?.position?.end?.offset;
	if (typeof endOffset === "number") {
		return raw.substring(endOffset).trim();
	}
	return raw;
}
