import { getLinkpath, type App, type TFile } from "obsidian";

/**
 * Whether a note links to the target the user wrote, such as "Movies" or "[[Movies#Top]]".
 * A target that resolves is compared by file; one that doesn't is compared with the note's unresolved links.
 */
export function linksTo(app: App, file: TFile, linktext: string): boolean {
	const path = getLinkpath(linktext.replace(/^\[\[|\]\]$/g, "").split("|")[0]).trim();
	if (!path) return false;
	const target = app.metadataCache.getFirstLinkpathDest(path, file.path);
	if (target) return !!app.metadataCache.resolvedLinks[file.path]?.[target.path];
	return !!app.metadataCache.unresolvedLinks[file.path]?.[path];
}
