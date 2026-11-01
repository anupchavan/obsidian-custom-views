import { parse, tokenize, type ASTNode, type ParserError, type Token } from "knap";

/**
 * Templates use Knap's grammar, the one Web Clipper and Importer use:
 * {{ }}, {% if/elseif/else %}, {% for %}, {% set %} and {# #} comments.
 * Knap parses the template, so its structure and syntax errors are Knap's.
 *
 * Knap never sees our expressions. Before parsing, each one is swapped for
 * its slot number (`{{ 3 }}`, `{% if 4 %}`), and the walker below hands slot
 * 3's source to the expression engine. Rendering is ours because Knap's
 * renderer is built for Markdown: it puts each loop iteration on its own line
 * and trims whitespace after every tag, which would change HTML output.
 */

export type SlotKind = "output" | "if" | "for" | "set";

export interface TemplateSlot {
	kind: SlotKind;
	/** The expression as written in the template. */
	source: string;
	/** Offset of the slot's opening `{{` or `{%` in the original template. */
	offset: number;
}

export interface CompiledTemplate {
	ast: ASTNode[];
	slots: TemplateSlot[];
	errors: ParserError[];
}

export interface TemplateHooks {
	/** Evaluate a slot's expression with the template variables in scope. */
	evaluate(slot: TemplateSlot, variables: Record<string, unknown>): Promise<unknown>;
	/** Truthiness for {% if %}, by the expression engine's rules. */
	isTruthy(value: unknown): boolean;
	/** Turn a {{ }} value into the text the template receives. */
	output(value: unknown, slot: TemplateSlot): string | Promise<string>;
}

export interface TemplateRenderResult {
	output: string;
	errors: ParserError[];
}

const compiled = new Map<string, CompiledTemplate>();
const COMPILED_LIMIT = 200;

export function compileTemplate(template: string): CompiledTemplate {
	const cached = compiled.get(template);
	if (cached) return cached;

	const { tokens } = tokenize(template);
	const lineStarts = [0];
	for (let i = 0; i < template.length; i++) {
		if (template[i] === "\n") lineStarts.push(i + 1);
	}
	const offsetOf = (token: Token) => lineStarts[token.line - 1] + token.column - 1;
	const after = (token: Token) => offsetOf(token) + token.value.length;

	const slots: TemplateSlot[] = [];
	let knapSource = "";
	let copied = 0;
	const replace = (from: number, to: number, kind: SlotKind, open: number) => {
		knapSource += `${template.slice(copied, from)} ${slots.length} `;
		slots.push({ kind, source: template.slice(from, to).trim(), offset: open });
		copied = to;
	};

	for (let i = 0; i < tokens.length; i++) {
		const start = tokens[i];
		if (start.type !== "variable_start" && start.type !== "tag_start") continue;
		const endType = start.type === "variable_start" ? "variable_end" : "tag_end";
		let end = i + 1;
		while (end < tokens.length && tokens[end].type !== endType && tokens[end].type !== "eof") end++;
		if (tokens[end]?.type !== endType) break;

		const open = offsetOf(start);
		const close = offsetOf(tokens[end]);
		const keyword = tokens[i + 1];

		if (start.type === "variable_start") {
			if (template.slice(after(start), close).trim()) replace(after(start), close, "output", open);
		} else if (keyword?.type === "keyword_if") {
			replace(after(keyword), close, "if", open);
		} else if (keyword?.type === "keyword_elseif" || (keyword?.type === "identifier" && keyword.value === "elif")) {
			// Knap spells it `elseif`; our templates also accept `elif`.
			const from = after(keyword);
			knapSource += `${template.slice(copied, offsetOf(keyword))}elseif`;
			copied = from;
			replace(from, close, "if", open);
		} else if (keyword?.type === "keyword_for" && tokens[i + 3]?.type === "keyword_in") {
			replace(after(tokens[i + 3]), close, "for", open);
		} else if (keyword?.type === "keyword_set" && tokens[i + 3]?.type === "op_assign") {
			replace(after(tokens[i + 3]), close, "set", open);
		}
		i = end;
	}
	knapSource += template.slice(copied);

	const { ast, errors } = parse(knapSource);
	const result = { ast, slots, errors };
	compiled.set(template, result);
	if (compiled.size > COMPILED_LIMIT) compiled.delete(compiled.keys().next().value as string);
	return result;
}

export async function renderTemplateWithKnap(
	template: string,
	hooks: TemplateHooks,
	variables: Record<string, unknown> = {},
): Promise<TemplateRenderResult> {
	const { ast, slots, errors } = compileTemplate(template);
	if (errors.length > 0) return { output: "", errors };

	const slotOf = (expression: { type: string; value?: unknown }) => slots[expression.value as number];

	const render = async (nodes: ASTNode[], variables: Record<string, unknown>): Promise<string> => {
		let output = "";
		for (const node of nodes) {
			switch (node.type) {
				case "text":
					output += node.value;
					break;
				case "variable": {
					const slot = slotOf(node.expression);
					output += await hooks.output(await hooks.evaluate(slot, variables), slot);
					break;
				}
				case "if": {
					const branches = [{ condition: node.condition, body: node.consequent }, ...node.elseifs];
					let body = node.alternate;
					for (const branch of branches) {
						if (hooks.isTruthy(await hooks.evaluate(slotOf(branch.condition), variables))) {
							body = branch.body;
							break;
						}
					}
					if (body) output += await render(body, variables);
					break;
				}
				case "for": {
					const list = await hooks.evaluate(slotOf(node.iterable), variables);
					if (!Array.isArray(list)) break;
					const items: unknown[] = list;
					for (let index = 0; index < items.length; index++) {
						output += await render(node.body, {
							...variables,
							[node.iterator]: items[index],
							loop: { index: index + 1, index0: index, first: index === 0, last: index === items.length - 1, length: items.length },
						});
					}
					break;
				}
				case "set":
					variables[node.variable] = await hooks.evaluate(slotOf(node.value), variables);
					break;
			}
		}
		return output;
	};

	return { output: await render(ast, variables), errors: [] };
}
