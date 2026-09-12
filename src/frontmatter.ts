import { getFrontMatterInfo, type CachedMetadata } from "obsidian";

/** Parse the current text instead of trusting offsets from an older cache revision. */
export function stripFrontmatter(cache: CachedMetadata | null | undefined, raw: string): string {
	// Preserve the existing contract for content that the host hasn't identified
	// as frontmatter (including template fragments that start with a rule).
	if (!cache?.frontmatterPosition && !cache?.frontmatter) return raw;
	const info = getFrontMatterInfo(raw);
	return info.exists ? raw.slice(info.contentStart).trim() : raw;
}
