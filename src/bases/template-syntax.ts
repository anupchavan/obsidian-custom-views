export interface TemplateBaseBlock {
	index: number;
	name?: string;
	content: string;
	start: number;
	end: number;
	line: number;
}

const TEMPLATE_BASE_BLOCK_RE = /(^|\n)([ \t]*)\{%\s*base\b([^%]*)%}[ \t]*(?:\n|$)([\s\S]*?)(^|\n)[ \t]*\{%\s*endbase\s*%}[ \t]*(?=\n|$)/gm;

export function extractTemplateBaseBlocks(template: string): TemplateBaseBlock[] {
	const blocks: TemplateBaseBlock[] = [];
	let match: RegExpExecArray | null;

	while ((match = TEMPLATE_BASE_BLOCK_RE.exec(template)) !== null) {
		const leadingNewline = match[1] ?? "";
		const start = match.index + leadingNewline.length;
		const end = match.index + match[0].length;
		blocks.push({
			index: blocks.length,
			name: parseTemplateBaseName(match[3] ?? ""),
			content: trimBlockContent(match[4] ?? ""),
			start,
			end,
			line: lineNumberAt(template, start),
		});
	}

	TEMPLATE_BASE_BLOCK_RE.lastIndex = 0;
	return blocks;
}

export function stripTemplateBaseBlocks(template: string): string {
	const blocks = extractTemplateBaseBlocks(template);
	if (blocks.length === 0) return template;

	let result = template;
	for (let i = blocks.length - 1; i >= 0; i--) {
		const block = blocks[i];
		result = result.slice(0, block.start) + result.slice(block.end);
	}
	return result;
}

function parseTemplateBaseName(args: string): string | undefined {
	const trimmed = args.trim();
	if (!trimmed) return undefined;

	const quoted = trimmed.match(/^"([^"]+)"$|^'([^']+)'$/);
	if (quoted) return quoted[1] ?? quoted[2];

	return trimmed;
}

function trimBlockContent(content: string): string {
	return content.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

function lineNumberAt(text: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset; i++) {
		if (text[i] === "\n") line++;
	}
	return line;
}
