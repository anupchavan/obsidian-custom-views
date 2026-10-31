import {
	checkExpressionSyntax,
	ExpressionSyntaxError,
	globalFunctions,
	isExpressionMode,
	methodNames,
	splitExpressionAndPipes,
	tokenize,
	TokenType,
	type Token,
	type TokenizeIssue,
} from "./expression";
import { filterNames } from "./filters";

export type DiagnosticSeverity = "error" | "warning";

/**
 * One problem in a template, CSS or JavaScript field. Messages and hints are
 * plain sentences; text in backticks is shown as code.
 */
export interface TemplateDiagnostic {
	/** Document range. Absent when the problem has no known position. */
	from?: number;
	to?: number;
	severity: DiagnosticSeverity;
	message: string;
	hint?: string;
}

export interface TemplateAnalysisOptions {
	/** Every frontmatter property name in the vault. Empty skips property checks. */
	properties?: readonly string[];
}

/** Names the expression engine answers without frontmatter. */
const BUILTIN_NAMES = new Set([
	"file", "content", "name", "basename", "size", "ctime", "mtime", "bases", "baseViews",
	"loop", "this", "value", "index", "true", "false", "null",
]);
const TAG_NAMES = ["if", "elif", "else", "endif", "for", "endfor", "set", "base", "endbase"];
const BLOCK_ENDS: Record<string, string> = { if: "endif", for: "endfor", base: "endbase" };
const FUNCTION_NAMES = [...Object.keys(globalFunctions), "if"];

interface ExpressionSite { text: string; offset: number; kind: "placeholder" | "expression" }
interface OpenBlock { kind: string; from: number; to: number; sawElse: boolean }

// ---------------------------------------------------------------------------
// Template ({{ }} placeholders and {% %} tags), used by all three fields
// ---------------------------------------------------------------------------

export function analyzeTemplate(source: string, options: TemplateAnalysisOptions = {}): TemplateDiagnostic[] {
	const out: TemplateDiagnostic[] = [];
	const properties = new Set(options.properties ?? []);
	const variables = new Set<string>();
	const sites: ExpressionSite[] = [];
	const skipped: [number, number][] = [];
	scanTags(source, out, sites, variables, skipped);
	scanPlaceholders(source, out, sites, skipped);
	for (const site of sites) analyzeSite(site, out, properties, variables);
	return out.sort((a, b) => (a.from ?? -1) - (b.from ?? -1));
}

function scanTags(source: string, out: TemplateDiagnostic[], sites: ExpressionSite[], variables: Set<string>, skipped: [number, number][]) {
	const stack: OpenBlock[] = [];
	const tag = (kind: string) => `\`{% ${kind} %}\``;
	let index = source.indexOf("{%");
	while (index !== -1) {
		const close = source.indexOf("%}", index + 2);
		const nextOpen = source.indexOf("{%", index + 2);
		if (close === -1 || (nextOpen !== -1 && nextOpen < close)) {
			out.push({ from: index, to: index + 2, severity: "error", message: "This `{%` tag is never closed", hint: "Add `%}` to end the tag." });
			index = nextOpen;
			continue;
		}
		const from = index, to = close + 2;
		const inner = source.slice(index + 2, close);
		const lead = inner.length - inner.trimStart().length;
		const body = inner.trim();
		const keyword = /^[A-Za-z_]+/.exec(body)?.[0] ?? "";
		const rest = body.slice(keyword.length);
		const restOffset = index + 2 + lead + keyword.length + (rest.length - rest.trimStart().length);
		const expression = rest.trim();
		const top = stack[stack.length - 1];
		switch (keyword) {
			case "if":
			case "elif":
				if (!expression) {
					out.push({ from, to, severity: "error", message: `${tag(keyword)} needs a condition`, hint: `Write it like \`{% ${keyword} rating > 3 %}\`.` });
				} else {
					sites.push({ text: expression, offset: restOffset, kind: "expression" });
				}
				if (keyword === "if") {
					stack.push({ kind: "if", from, to, sawElse: false });
				} else if (top?.kind !== "if") {
					out.push({ from, to, severity: "error", message: `${tag("elif")} is outside an ${tag("if")} block`, hint: "Move it between an `{% if %}` and its `{% endif %}`." });
				} else if (top.sawElse) {
					out.push({ from, to, severity: "error", message: `${tag("elif")} comes after ${tag("else")}`, hint: "Move it above the `{% else %}`, which must be the last branch." });
				}
				break;
			case "else":
				if (top?.kind !== "if") {
					out.push({ from, to, severity: "error", message: `${tag("else")} is outside an ${tag("if")} block`, hint: "Move it between an `{% if %}` and its `{% endif %}`." });
				} else if (top.sawElse) {
					out.push({ from, to, severity: "error", message: `This ${tag("if")} already has an ${tag("else")}`, hint: "Remove one of them, or turn the first into `{% elif condition %}`." });
				} else {
					top.sawElse = true;
				}
				break;
			case "for": {
				const loop = /^([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]+)$/.exec(expression);
				if (!loop) {
					out.push({ from, to, severity: "error", message: "This loop isn't written the way `{% for %}` expects", hint: "Write it like `{% for actor in cast %}`." });
				} else {
					variables.add(loop[1]);
					sites.push({ text: loop[2], offset: restOffset + expression.indexOf(loop[2], loop[1].length), kind: "expression" });
				}
				stack.push({ kind: "for", from, to, sawElse: false });
				break;
			}
			case "set": {
				const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(expression);
				if (!assignment) {
					out.push({ from, to, severity: "error", message: `${tag("set")} isn't written the way it expects`, hint: "Write it like `{% set score = rating * 10 %}`." });
				} else {
					variables.add(assignment[1]);
					sites.push({ text: assignment[2], offset: restOffset + expression.lastIndexOf(assignment[2]), kind: "expression" });
				}
				break;
			}
			case "base":
				stack.push({ kind: "base", from, to, sawElse: false });
				break;
			case "endif":
			case "endfor":
			case "endbase": {
				const opener = keyword.slice(3);
				const match = stack.map(block => block.kind).lastIndexOf(opener);
				if (match === -1) {
					out.push({ from, to, severity: "error", message: `${tag(keyword)} has no opening ${tag(opener)}`, hint: `Remove it, or add \`{% ${opener} … %}\` above it.` });
					break;
				}
				if (match !== stack.length - 1) {
					const inner = stack[stack.length - 1];
					out.push({ from, to, severity: "error", message: `${tag(keyword)} closes ${tag(opener)} while ${tag(inner.kind)} from line ${lineOf(source, inner.from)} is still open`, hint: `Close the \`${inner.kind}\` with \`{% ${BLOCK_ENDS[inner.kind]} %}\` first.` });
				}
				const [block] = stack.splice(match);
				if (block.kind === "base") skipped.push([block.to, from]);
				break;
			}
			case "":
				out.push({ from, to, severity: "error", message: body ? `\`${body.split(/\s/)[0]}\` isn't a tag name` : "This tag is empty", hint: `Tags start with a name: ${TAG_NAMES.map(name => `\`${name}\``).join(", ")}.` });
				break;
			default: {
				const guess = closest(keyword, TAG_NAMES);
				out.push({ from, to: index + 2 + lead + keyword.length, severity: "error", message: `Unknown tag \`${keyword}\``, hint: guess ? `Did you mean \`${guess}\`?` : `Tags are ${TAG_NAMES.map(name => `\`${name}\``).join(", ")}.` });
			}
		}
		index = source.indexOf("{%", to);
	}
	for (const block of stack) {
		out.push({ from: block.from, to: block.to, severity: "error", message: `This ${tag(block.kind)} is never closed`, hint: `Add \`{% ${BLOCK_ENDS[block.kind]} %}\` where the ${block.kind === "if" ? "conditional part" : block.kind === "for" ? "repeated part" : "base"} should end.` });
	}
}

function scanPlaceholders(source: string, out: TemplateDiagnostic[], sites: ExpressionSite[], skipped: [number, number][]) {
	let index = source.indexOf("{{");
	while (index !== -1) {
		const inBase = skipped.find(([from, to]) => index >= from && index < to);
		if (inBase) {
			index = source.indexOf("{{", inBase[1]);
			continue;
		}
		const close = source.indexOf("}}", index + 2);
		const nextOpen = source.indexOf("{{", index + 2);
		if (close === -1 || (nextOpen !== -1 && nextOpen < close)) {
			out.push({ from: index, to: index + 2, severity: "error", message: "This placeholder is never closed", hint: "Add `}}` after the expression." });
			index = nextOpen;
			continue;
		}
		sites.push({ text: source.slice(index + 2, close), offset: index + 2, kind: "placeholder" });
		index = source.indexOf("{{", close + 2);
	}
}

function analyzeSite(site: ExpressionSite, out: TemplateDiagnostic[], properties: Set<string>, variables: Set<string>) {
	const lead = site.text.length - site.text.trimStart().length;
	const text = site.text.trim();
	const offset = site.offset + lead;
	if (site.kind === "expression") {
		checkExpression(text, offset, out, properties, variables);
		return;
	}
	if (!text) {
		out.push({ from: site.offset - 2, to: site.offset + site.text.length + 2, severity: "warning", message: "This placeholder is empty", hint: "Put a property or expression between the braces, like `{{title}}`." });
		return;
	}
	if (text === "content" || text === "file.content") return;
	if (isExpressionMode(text)) {
		const { expression, pipeFilters } = splitExpressionAndPipes(text);
		checkExpression(expression, offset, out, properties, variables);
		if (pipeFilters !== null) checkFilters(text, offset, text.length - text.slice(expression.length).trimStart().length + 1, out);
		return;
	}
	const pipe = firstPipe(text);
	const chain = (pipe === -1 ? text : text.slice(0, pipe)).trim();
	if (/^[A-Za-z_]/.test(chain) && !chain.startsWith("file.")) {
		const name = /^[^.[]+/.exec(chain)?.[0].trim() ?? "";
		if (name && !BUILTIN_NAMES.has(name) && !variables.has(name)) checkProperty(name, offset, offset + name.length, out, properties);
	}
	if (pipe !== -1) checkFilters(text, offset, pipe + 1, out);
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

function checkExpression(expression: string, offset: number, out: TemplateDiagnostic[], properties: Set<string>, variables: Set<string>) {
	const issues: TokenizeIssue[] = [];
	const tokens = tokenize(expression, issues);
	if (issues.length) {
		for (const issue of issues) out.push(describeIssue(issue, expression, offset));
		return;
	}
	try {
		checkExpressionSyntax(expression);
	} catch (error) {
		if (error instanceof ExpressionSyntaxError) out.push(describeSyntaxError(error, tokens, expression, offset));
		return;
	}
	tokens.forEach((token, index) => {
		if (token.type !== TokenType.Identifier) return;
		const previous = tokens[index - 1];
		const next = tokens[index + 1];
		const from = offset + token.pos, to = from + token.value.length;
		if (previous?.type === TokenType.Dot) {
			if (next?.type === TokenType.LParen && !methodNames.has(token.value)) {
				const guess = closest(token.value, [...methodNames]);
				out.push({ from, to, severity: "error", message: `Unknown method \`.${token.value}()\``, hint: guess ? `Did you mean \`.${guess}()\`?` : "It returns nothing, so this part renders empty." });
			}
			return;
		}
		if (next?.type === TokenType.LParen) {
			if (FUNCTION_NAMES.includes(token.value)) return;
			const guess = closest(token.value, FUNCTION_NAMES);
			const filter = filterNames.includes(token.value);
			out.push({ from, to, severity: "error", message: `Unknown function \`${token.value}()\``,
				hint: filter && !guess ? `\`${token.value}\` is a filter. Apply it with a pipe: \`value | ${token.value}\`.` : guess ? `Did you mean \`${guess}()\`?` : "It returns nothing, so this part renders empty." });
			return;
		}
		if (BUILTIN_NAMES.has(token.value) || variables.has(token.value)) return;
		checkProperty(token.value, from, to, out, properties);
	});
}

const TOKEN_TEXT: Partial<Record<TokenType, string>> = {
	[TokenType.LParen]: "(", [TokenType.RParen]: ")", [TokenType.LBracket]: "[", [TokenType.RBracket]: "]",
	[TokenType.Dot]: ".", [TokenType.Comma]: ",",
};
const OPERATORS = new Set([TokenType.Plus, TokenType.Minus, TokenType.Star, TokenType.Slash, TokenType.Percent, TokenType.Power,
	TokenType.Eq, TokenType.Neq, TokenType.Lt, TokenType.Gt, TokenType.Lte, TokenType.Gte, TokenType.And, TokenType.Or,
	TokenType.Not, TokenType.Coalesce, TokenType.Dot, TokenType.Comma]);
const VALUES = new Set([TokenType.Identifier, TokenType.Number, TokenType.String, TokenType.Regex]);

function tokenLength(token: Token, expression: string): number {
	if (token.type !== TokenType.String) return Math.max(1, token.value.length);
	const quote = expression[token.pos];
	let index = token.pos + 1;
	while (index < expression.length && expression[index] !== quote) index += expression[index] === "\\" ? 2 : 1;
	return Math.min(expression.length, index + 1) - token.pos;
}

function shown(token: Token): string {
	if (token.type === TokenType.String) return `\`"${token.value}"\``;
	return `\`${token.value}\``;
}

function describeSyntaxError(error: ExpressionSyntaxError, tokens: Token[], expression: string, offset: number): TemplateDiagnostic {
	const { token, expected } = error;
	const index = tokens.findIndex(candidate => candidate.pos === token.pos && candidate.type === token.type);
	const previous = index > 0 ? tokens[index - 1] : undefined;
	const at = (from: number, length: number) => ({ from: offset + from, to: offset + from + length, severity: "error" as const });

	// A missing closer is easiest to fix from the opener that needs it.
	if ((expected === TokenType.RParen || expected === TokenType.RBracket) && token.type === TokenType.EOF) {
		const opener = unclosedOpener(tokens, expected === TokenType.RParen ? TokenType.LParen : TokenType.LBracket);
		const open = expected === TokenType.RParen ? "(" : "[", close = TOKEN_TEXT[expected];
		if (opener) return { ...at(opener.pos, 1), message: `This \`${open}\` is never closed`, hint: `Add \`${close}\` after its contents.` };
	}
	if (expected === TokenType.Identifier && previous?.type === TokenType.Dot) {
		return { ...at(previous.pos, 1), message: "Expected a name after `.`", hint: "Write a property or method name, like `.length` or `.asFile()`." };
	}
	// Conditions and `{% set %}` values can't take filters, only placeholders can.
	if (token.type === TokenType.Pipe) {
		return { ...at(token.pos, 1), message: "A filter can't go here", hint: "Filters go at the end of a placeholder, like `{{ title | upper }}`. Inside conditions, use methods such as `title.upper()`." };
	}
	if (expected === TokenType.EOF) {
		const message = `Unexpected ${shown(token)} after the expression`;
		if (token.type === TokenType.RParen || token.type === TokenType.RBracket) {
			return { ...at(token.pos, 1), message, hint: `There's no \`${token.type === TokenType.RParen ? "(" : "["}\` for it to close.` };
		}
		const hint = VALUES.has(token.type)
			? "Join values with an operator such as `+`, `and` or `??`. To apply a filter, put `|` before it."
			: "Remove it, or add the rest of the expression around it.";
		return { ...at(token.pos, tokenLength(token, expression)), message, hint };
	}
	if (expected !== undefined) {
		const want = TOKEN_TEXT[expected] ? `\`${TOKEN_TEXT[expected]}\`` : "a name";
		if (token.type === TokenType.EOF) {
			return { ...at(Math.max(0, expression.length - 1), 1), message: `The expression ends before ${want}`, hint: `Add ${want} at the end.` };
		}
		const hint = (expected === TokenType.RParen || expected === TokenType.RBracket) && VALUES.has(token.type)
			? "Separate items with a comma."
			: undefined;
		return { ...at(token.pos, tokenLength(token, expression)), message: `Expected ${want} but found ${shown(token)}`, hint };
	}
	if (token.type === TokenType.EOF) {
		const last = previous ?? tokens[0];
		const operator = last && OPERATORS.has(last.type);
		return {
			...at(last ? last.pos : 0, last ? tokenLength(last, expression) : 1),
			message: "The expression ends too early",
			hint: operator ? `Add a value after ${shown(last)}.` : "Something is missing at the end.",
		};
	}
	return { ...at(token.pos, tokenLength(token, expression)), message: `Unexpected ${shown(token)}`, hint: "A value, a name or `(` was expected here." };
}

function unclosedOpener(tokens: Token[], open: TokenType): Token | undefined {
	const close = open === TokenType.LParen ? TokenType.RParen : TokenType.RBracket;
	const stack: Token[] = [];
	for (const token of tokens) {
		if (token.type === open) stack.push(token);
		else if (token.type === close) stack.pop();
	}
	return stack[stack.length - 1];
}

function describeIssue(issue: TokenizeIssue, expression: string, offset: number): TemplateDiagnostic {
	if (issue.kind === "unterminated-string") {
		return { from: offset + issue.pos, to: offset + expression.length, severity: "error", message: "This text is never closed", hint: `Add a matching \`${issue.text}\` to end it.` };
	}
	const hints: Record<string, string> = {
		"=": "To compare values, use `==`.",
		"&": "To require both, use `&&` or `and`.",
		"?": "For a fallback value use `??`, and for a choice use `if(condition, yes, no)`.",
		";": "Expressions don't need a `;`.",
	};
	return {
		from: offset + issue.pos, to: offset + issue.pos + 1, severity: "error",
		message: `Unexpected \`${issue.text}\``,
		hint: hints[issue.text] ?? "This character isn't part of the expression language, so it is ignored.",
	};
}

// ---------------------------------------------------------------------------
// Filters and properties
// ---------------------------------------------------------------------------

/** Split a filter chain the way knap does: on `|` outside quotes and brackets. */
function filterSegments(chain: string): { text: string; start: number }[] {
	const segments: { text: string; start: number }[] = [];
	let depth = 0, quote = "", start = 0;
	for (let index = 0; index <= chain.length; index++) {
		const ch = chain[index];
		if (index === chain.length || (ch === "|" && !quote && depth === 0)) {
			segments.push({ text: chain.slice(start, index), start });
			start = index + 1;
		} else if (quote) {
			if (ch === "\\") index++;
			else if (ch === quote) quote = "";
		} else if (ch === '"' || ch === "'") quote = ch;
		else if (ch === "(" || ch === "{" || ch === "[") depth++;
		else if (ch === ")" || ch === "}" || ch === "]") depth--;
	}
	return segments;
}

function checkFilters(text: string, offset: number, chainStart: number, out: TemplateDiagnostic[]) {
	for (const segment of filterSegments(text.slice(chainStart))) {
		const lead = segment.text.length - segment.text.trimStart().length;
		const from = offset + chainStart + segment.start + lead;
		const body = segment.text.trim();
		if (!body) {
			out.push({ from: offset + chainStart - 1, to: offset + chainStart, severity: "error", message: "There's no filter after this `|`", hint: "Add a filter name, or remove the `|`." });
			continue;
		}
		const name = /^[^:(\s]*/.exec(body)?.[0] ?? "";
		const to = from + Math.max(1, name.length);
		if (filterNames.includes(name)) {
			if (body[name.length] === "(") {
				out.push({ from, to: from + body.length, severity: "error", message: `Filter arguments go after a colon, not in brackets`, hint: `Write it like \`${name}:"…"\`.` });
			}
			continue;
		}
		const guess = closest(name, filterNames);
		out.push({ from, to, severity: "error", message: `Unknown filter \`${name}\``,
			hint: guess ? `Did you mean \`${guess}\`? Unknown filters are skipped, so the value shows unfiltered.` : "Unknown filters are skipped, so the value shows unfiltered. Type `|` to see the available filters." });
	}
}

function checkProperty(name: string, from: number, to: number, out: TemplateDiagnostic[], properties: Set<string>) {
	if (!properties.size || properties.has(name)) return;
	const sameLetters = [...properties].find(property => property.toLowerCase() === name.toLowerCase());
	if (sameLetters) {
		out.push({ from, to, severity: "warning", message: `No note has a property named \`${name}\``, hint: `Property names are case-sensitive. Did you mean \`${sameLetters}\`?` });
		return;
	}
	const guess = closest(name, [...properties]);
	out.push({ from, to, severity: "warning", message: `No note has a property named \`${name}\``,
		hint: guess ? `Did you mean \`${guess}\`?` : "It renders empty until a note has this property." });
}

function firstPipe(text: string): number {
	let quote = "";
	for (let index = 0; index < text.length; index++) {
		const ch = text[index];
		if (quote) { if (ch === quote) quote = ""; }
		else if (ch === '"' || ch === "'") quote = ch;
		else if (ch === "|") return index;
	}
	return -1;
}

// ---------------------------------------------------------------------------
// CSS and JavaScript syntax, checked with the editor's own parsers
// ---------------------------------------------------------------------------

/**
 * Blank out template syntax, keeping offsets, so a language parser sees valid
 * code: a placeholder stands in for a value, a tag for nothing at all.
 */
export function maskTemplateSyntax(source: string): string {
	return source.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, match => match.replace(/[^\n]/g, match[1] === "{" ? "_" : " "));
}

interface SyntaxTree { iterate(spec: { enter(node: { type: { isError: boolean }; from: number }): boolean | void }): void }
type Parser = { parse(input: string): SyntaxTree };

function firstErrorPosition(parser: Parser, code: string): number | undefined {
	let position: number | undefined;
	parser.parse(code).iterate({ enter: node => {
		if (position !== undefined) return false;
		if (node.type.isError) position = node.from;
	} });
	return position;
}

/** Brackets outside strings and comments; `/* *\/` and `//` comments as given. */
function unbalancedBracket(code: string, lineComments: boolean): TemplateDiagnostic | undefined {
	const pairs: Record<string, string> = { "}": "{", ")": "(", "]": "[" };
	const stack: { ch: string; at: number }[] = [];
	for (let index = 0; index < code.length; index++) {
		const ch = code[index];
		if (ch === "/" && code[index + 1] === "*") { const end = code.indexOf("*/", index + 2); index = end === -1 ? code.length : end + 1; continue; }
		if (lineComments && ch === "/" && code[index + 1] === "/") { const end = code.indexOf("\n", index); index = end === -1 ? code.length : end; continue; }
		if (ch === '"' || ch === "'" || (lineComments && ch === "`")) {
			let end = index + 1;
			while (end < code.length && code[end] !== ch && (ch === "`" || code[end] !== "\n")) end += code[end] === "\\" ? 2 : 1;
			index = end;
			continue;
		}
		if (ch === "{" || ch === "(" || ch === "[") stack.push({ ch, at: index });
		else if (pairs[ch]) {
			const open = stack.pop();
			if (!open) return { from: index, to: index + 1, severity: "error", message: `Unexpected \`${ch}\``, hint: `There's no \`${pairs[ch]}\` for it to close.` };
			if (open.ch !== pairs[ch]) {
				const want = Object.keys(pairs).find(key => pairs[key] === open.ch)!;
				return { from: index, to: index + 1, severity: "error", message: `Expected \`${want}\` but found \`${ch}\``, hint: `The \`${open.ch}\` on line ${lineOf(code, open.at)} is still open.` };
			}
		}
	}
	const open = stack.pop();
	if (open) {
		const close = Object.keys(pairs).find(key => pairs[key] === open.ch)!;
		return { from: open.at, to: open.at + 1, severity: "error", message: `This \`${open.ch}\` is never closed`, hint: `Add \`${close}\` where it should end.` };
	}
	return undefined;
}

export function analyzeCss(source: string, parser: Parser): TemplateDiagnostic[] {
	const code = maskTemplateSyntax(source);
	const bracket = unbalancedBracket(code, false);
	if (bracket) return [bracket];
	const position = firstErrorPosition(parser, code);
	if (position === undefined) return [];
	// A declaration with no colon is the commonest CSS slip; name it directly.
	const declarationStart = Math.max(code.lastIndexOf("{", position - 1), code.lastIndexOf(";", position - 1)) + 1;
	const declarationEnd = code.slice(position).search(/[;{}]/);
	const declaration = code.slice(declarationStart, declarationEnd === -1 ? code.length : position + declarationEnd);
	const property = /^\s*([\w-]+)\s+[^:\s]/.exec(declaration);
	if (property && !declaration.includes(":")) {
		const from = declarationStart + declaration.indexOf(property[1]);
		return [{ from, to: from + property[1].length, severity: "error", message: `Expected \`:\` after \`${property[1]}\``, hint: "Put a `:` between the property and its value." }];
	}
	const word = /^(?:[\w-]+|\S)/.exec(code.slice(position))?.[0];
	return [{
		from: position, to: position + (word?.length ?? 0), severity: "error",
		message: word ? `Unexpected \`${word}\`` : "The CSS ends unexpectedly",
		hint: "Check this line for a missing `:`, `;` or `}`.",
	}];
}

type ScriptConstructor = new (contextName: string, body: string) => unknown;
const AsyncFunction = (Object.getPrototypeOf(async function () {}) as { constructor: ScriptConstructor }).constructor;
/** Lines script-engine.ts's generated function adds before the author's first line. */
export const SCRIPT_LINE_OFFSET = 3;

export function analyzeJavaScript(source: string, parser: Parser): TemplateDiagnostic[] {
	const code = maskTemplateSyntax(source);
	try {
		// Compiling never runs the code. A function body accepts `await` and `return`, as the script engine does.
		new AsyncFunction("tp", code);
		return [];
	} catch (error) {
		if (!(error instanceof SyntaxError)) return [];
		// V8 closes the generated wrapper itself, so an unfinished script reports
		// the wrapper's own `)` or `}`. The brackets in the author's code say more.
		const position = firstErrorPosition(parser, code);
		const end = code.trimEnd().length;
		const atEnd = position === undefined || position >= end;
		const bracket = unbalancedBracket(code, true);
		if (bracket && (atEnd || bracket.from === position)) return [bracket];
		if (atEnd) {
			return [{ from: Math.max(0, end - 1), to: end, severity: "error", message: "The code ends unexpectedly", hint: "A bracket, quote or statement may be unfinished." }];
		}
		const message = error.message.replace(/\.$/, "");
		const word = /^(?:[\w$]+|\S)/.exec(code.slice(position))?.[0];
		const hint = /unexpected identifier/i.test(message) ? "A `,`, `;` or operator may be missing before it."
			: /unexpected (string|number)/i.test(message) ? "A `,` or operator may be missing before it."
			: undefined;
		return [{ from: position, to: position + (word?.length ?? 0), severity: "error", message, hint }];
	}
}

/** Where a runtime error happened in the author's script, from a V8 stack. */
export function scriptErrorPosition(error: unknown): { line: number; column: number } | undefined {
	const stack = error instanceof Error ? error.stack ?? "" : "";
	const frame = /<anonymous>:(\d+):(\d+)/.exec(stack);
	if (!frame) return undefined;
	const line = Number(frame[1]) - SCRIPT_LINE_OFFSET;
	return line >= 1 ? { line, column: Number(frame[2]) } : undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function lineOf(text: string, offset: number): number {
	let line = 1;
	for (let index = text.indexOf("\n"); index !== -1 && index < offset; index = text.indexOf("\n", index + 1)) line++;
	return line;
}

/** The closest candidate within a small edit distance, for "did you mean". */
export function closest(word: string, candidates: readonly string[]): string | undefined {
	if (!word) return undefined;
	const lower = word.toLowerCase();
	const exact = candidates.find(candidate => candidate.toLowerCase() === lower);
	if (exact) return exact;
	const limit = word.length <= 4 ? 1 : 2;
	let best: string | undefined, bestDistance = limit + 1;
	for (const candidate of candidates) {
		if (Math.abs(candidate.length - word.length) > limit) continue;
		const distance = editDistance(lower, candidate.toLowerCase(), limit);
		if (distance < bestDistance) { best = candidate; bestDistance = distance; }
	}
	return best;
}

/** Optimal string alignment distance: an adjacent swap ("imgae") counts as one edit. */
function editDistance(a: string, b: string, limit: number): number {
	let before: number[] = [];
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		let rowMin = i;
		for (let j = 1; j <= b.length; j++) {
			let cost = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cost = Math.min(cost, before[j - 2] + 1);
			current[j] = cost;
			rowMin = Math.min(rowMin, cost);
		}
		if (rowMin > limit) return limit + 1;
		before = previous;
		previous = current;
	}
	return previous[b.length];
}
