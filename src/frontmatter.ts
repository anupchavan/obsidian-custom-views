import { getAllTags, getFrontMatterInfo, type CachedMetadata } from "obsidian";

/** Parse the current text instead of trusting offsets from an older cache revision. */
export function stripFrontmatter(cache: CachedMetadata | null | undefined, raw: string): string {
	// Preserve the existing contract for content that the host hasn't identified
	// as frontmatter (including template fragments that start with a rule).
	if (!cache?.frontmatterPosition && !cache?.frontmatter) return raw;
	const info = getFrontMatterInfo(raw);
	return info.exists ? raw.slice(info.contentStart).trim() : raw;
}

/** Every tag on a note, body and properties, as Obsidian collects them (with "#", no duplicates). */
export function noteTags(cache: CachedMetadata | null | undefined, frontmatter = cache?.frontmatter): string[] {
	return [...new Set(getAllTags({ ...cache, frontmatter }) ?? [])];
}

/** Whether a note has a tag or one nested under it, ignoring case, as Bases and search match tags. */
export function hasTag(tags: readonly string[], tag: string): boolean {
	const wanted = tag.replace(/^#/, "").toLowerCase();
	if (!wanted) return false;
	return tags.some(candidate => {
		const name = candidate.replace(/^#/, "").toLowerCase();
		return name === wanted || name.startsWith(`${wanted}/`);
	});
}
