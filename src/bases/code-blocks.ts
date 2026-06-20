export interface EmbeddedBaseBlock {
	index: number;
	content: string;
	start: number;
	end: number;
	line: number;
}

export interface EmbeddedBaseFileLink {
	index: number;
	target: string;
	viewName?: string;
	display?: string;
	start: number;
	end: number;
	line: number;
}

export interface CollectorBaseDocument {
	sourceIndex: number;
	viewIndex: number;
	viewName: string;
	originalType: string;
	config: Record<string, unknown>;
}

interface ValidBaseView extends Record<string, unknown> {
	name: string;
	type: string;
}

const BASE_CODE_BLOCK_RE = /(^|\n)(`{3,}|~{3,})[ \t]*base(?:[ \t][^\n]*)?\n([\s\S]*?)\n\2[ \t]*(?=\n|$)/g;
const WIKILINK_EMBED_RE = /!\[\[([^\]\n]+)\]\]/g;

export function extractEmbeddedBaseBlocks(markdown: string): EmbeddedBaseBlock[] {
	const blocks: EmbeddedBaseBlock[] = [];
	let match: RegExpExecArray | null;

	while ((match = BASE_CODE_BLOCK_RE.exec(markdown)) !== null) {
		const leadingNewline = match[1] ?? "";
		const start = match.index + leadingNewline.length;
		const content = match[3];
		blocks.push({
			index: blocks.length,
			content,
			start,
			end: match.index + match[0].length,
			line: lineNumberAt(markdown, start),
		});
	}

	BASE_CODE_BLOCK_RE.lastIndex = 0;
	return blocks;
}

export function extractEmbeddedBaseFileLinks(markdown: string): EmbeddedBaseFileLink[] {
	const links: EmbeddedBaseFileLink[] = [];
	let match: RegExpExecArray | null;

	while ((match = WIKILINK_EMBED_RE.exec(markdown)) !== null) {
		const parsed = parseBaseEmbedLink(match[1]);
		if (!parsed) continue;

		links.push({
			index: links.length,
			target: parsed.target,
			viewName: parsed.viewName,
			display: parsed.display,
			start: match.index,
			end: match.index + match[0].length,
			line: lineNumberAt(markdown, match.index),
		});
	}

	WIKILINK_EMBED_RE.lastIndex = 0;
	return links;
}

export function createCollectorBaseDocuments(
	baseConfig: unknown,
	sourceIndex: number,
	viewName?: string,
): CollectorBaseDocument[] {
	if (!isRecord(baseConfig) || !Array.isArray(baseConfig.views)) return [];

	const documents: CollectorBaseDocument[] = [];
	const validViews: { view: ValidBaseView; index: number }[] = [];
	baseConfig.views.forEach((view, index) => {
		if (isValidBaseView(view)) {
			validViews.push({ view, index });
		}
	});
	const selected = viewName
		? validViews.find(entry => entry.view.name === viewName)
		: validViews[0];

	if (selected) {
		const view = selected.view;
		const viewIndex = selected.index;
		const clonedConfig = cloneRecord(baseConfig);
		const clonedView = cloneRecord(view);
		const originalType = view.type;

		clonedConfig.views = [clonedView];

		documents.push({
			sourceIndex,
			viewIndex,
			viewName: view.name,
			originalType,
			config: clonedConfig,
		});
	}

	return documents;
}

export function templateReferencesBases(...templates: (string | undefined)[]): boolean {
	return templates.some(template => !!template && /\b(?:file\.)?(?:bases|baseViews)\b/.test(template));
}

function lineNumberAt(text: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset; i++) {
		if (text[i] === "\n") line++;
	}
	return line;
}

function parseBaseEmbedLink(rawLink: string): Omit<EmbeddedBaseFileLink, "index" | "start" | "end" | "line"> | null {
	const [targetWithSubpath, display] = rawLink.split("|", 2).map(part => part.trim());
	const hashIndex = targetWithSubpath.indexOf("#");
	const target = hashIndex === -1 ? targetWithSubpath : targetWithSubpath.slice(0, hashIndex).trim();
	const viewName = hashIndex === -1 ? undefined : targetWithSubpath.slice(hashIndex + 1).trim();

	if (!target.toLowerCase().endsWith(".base")) return null;

	return {
		target,
		viewName: viewName || undefined,
		display: display || undefined,
	};
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
	return cloneValue(record) as Record<string, unknown>;
}

function cloneValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(cloneValue);
	if (isRecord(value)) {
		const clone: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value)) {
			clone[key] = cloneValue(child);
		}
		return clone;
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidBaseView(value: unknown): value is ValidBaseView {
	return isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.type === "string";
}
