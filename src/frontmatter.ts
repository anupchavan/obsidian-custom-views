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
	const endOffset =
		cache?.frontmatterPosition?.end?.offset ??
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
		((cache?.frontmatter as any)?.position?.end?.offset as number | undefined);
	if (typeof endOffset === "number") {
		return raw.substring(endOffset).trim();
	}
	return raw;
}
