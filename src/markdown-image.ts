/** A whole-value wikilink or embed, such as `[[photo.png]]` or `![[photo.png|200]]`. */
const WIKILINK_RE = /^!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]$/;

function formatMarkdownDestination(src: string): string {
	const needsAngleBrackets = /[\s()<>]/.test(src);
	return needsAngleBrackets
		? `<${src.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\n/g, "%0A")}>`
		: src;
}

/**
 * Markdown image for a path, a file name or a wikilink to the file. Obsidian
 * resolves the destination like any other link, so `[[photo.png]]` becomes
 * `![](photo.png)` rather than a destination with the brackets left in.
 */
export function formatMarkdownImage(src: string, alt: string): string {
	const wikilink = WIKILINK_RE.exec(src.trim());
	const destination = wikilink ? wikilink[1].trim() : src;
	return `![${alt}](${formatMarkdownDestination(destination)})`;
}

export function formatMarkdownLink(destination: string, label: string): string {
	return `[${label}](${formatMarkdownDestination(destination)})`;
}
