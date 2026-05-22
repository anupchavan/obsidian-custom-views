/**
 * Expression engine supporting Bases-style function/method syntax.
 *
 * Examples:
 *   link(cast[0]).asFile().content()
 *   if(rating > 8, "Great", "OK")
 *   tags.filter(value > 2).join(",")
 *   for(cast, "{{value.name}}")
 *   now().format("YYYY-MM-DD")
 *
 * The engine tokenizes, parses into an AST, then evaluates asynchronously
 * (since file reads are async).
 */

import { App, TFile, moment } from "obsidian";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ExprValueArray extends Array<ExprValue> {}
export interface ExprValueRecord { [key: string]: ExprValue; }

export type ExprValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| ExprValueArray
	| ExprValueRecord
	| ExprFile
	| ExprLink
	| ExprDate;

/** Wrapper for a resolved Obsidian file */
export interface ExprFile {
	__type: "file";
	name: string;
	basename: string;
	path: string;
	folder: string;
	ext: string;
	size: number;
	ctime: number;
	mtime: number;
	tags: string[];
	links: string[];
	properties: Record<string, ExprValue>;
	_tfile: TFile;
}

/** Wrapper for a wiki-link */
export interface ExprLink {
	__type: "link";
	target: string;
	display?: string;
}

/** Wrapper for a date/moment value */
export interface ExprDate {
	__type: "date";
	_moment: moment.Moment;
}

/** Evaluation context passed through the expression engine */
export interface ExprContext {
	app: App;
	file: TFile;
	frontmatter: Record<string, unknown> | undefined;
	bodyContent: string;
	variables: Record<string, ExprValue>;
}

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

enum TokenType {
	Number,
	String,
	Identifier,
	LParen,
	RParen,
	LBracket,
	RBracket,
	Dot,
	Comma,
	Plus,
	Minus,
	Star,
	Slash,
	Percent,
	Power,
	Eq,
	Neq,
	Lt,
	Gt,
	Lte,
	Gte,
	And,
	Or,
	Not,
	Pipe,
	EOF,
}

interface Token {
	type: TokenType;
	value: string;
	pos: number;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

export function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while (i < input.length) {
		const ch = input[i];

		// Whitespace
		if (/\s/.test(ch)) { i++; continue; }

		// Numbers
		if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < input.length && /[0-9]/.test(input[i + 1]))) {
			const start = i;
			while (i < input.length && /[0-9]/.test(input[i])) i++;
			if (i < input.length && input[i] === '.') {
				i++;
				while (i < input.length && /[0-9]/.test(input[i])) i++;
			}
			tokens.push({ type: TokenType.Number, value: input.slice(start, i), pos: start });
			continue;
		}

		// Strings (double or single quoted)
		if (ch === '"' || ch === "'") {
			const quote = ch;
			const start = i;
			i++;
			let str = '';
			while (i < input.length && input[i] !== quote) {
				if (input[i] === '\\' && i + 1 < input.length) {
					i++;
					if (input[i] === 'n') str += '\n';
					else if (input[i] === 't') str += '\t';
					else str += input[i];
				} else {
					str += input[i];
				}
				i++;
			}
			i++; // closing quote
			tokens.push({ type: TokenType.String, value: str, pos: start });
			continue;
		}

		// Two-char operators
		if (i + 1 < input.length) {
			const two = input.slice(i, i + 2);
			if (two === '==') { tokens.push({ type: TokenType.Eq, value: '==', pos: i }); i += 2; continue; }
			if (two === '!=') { tokens.push({ type: TokenType.Neq, value: '!=', pos: i }); i += 2; continue; }
			if (two === '<=') { tokens.push({ type: TokenType.Lte, value: '<=', pos: i }); i += 2; continue; }
			if (two === '>=') { tokens.push({ type: TokenType.Gte, value: '>=', pos: i }); i += 2; continue; }
			if (two === '&&') { tokens.push({ type: TokenType.And, value: '&&', pos: i }); i += 2; continue; }
			if (two === '||') { tokens.push({ type: TokenType.Or, value: '||', pos: i }); i += 2; continue; }
			if (two === '**') { tokens.push({ type: TokenType.Power, value: '**', pos: i }); i += 2; continue; }
		}

		// Single-char tokens
		if (ch === '(') { tokens.push({ type: TokenType.LParen, value: '(', pos: i }); i++; continue; }
		if (ch === ')') { tokens.push({ type: TokenType.RParen, value: ')', pos: i }); i++; continue; }
		if (ch === '[') { tokens.push({ type: TokenType.LBracket, value: '[', pos: i }); i++; continue; }
		if (ch === ']') { tokens.push({ type: TokenType.RBracket, value: ']', pos: i }); i++; continue; }
		if (ch === '.') { tokens.push({ type: TokenType.Dot, value: '.', pos: i }); i++; continue; }
		if (ch === ',') { tokens.push({ type: TokenType.Comma, value: ',', pos: i }); i++; continue; }
		if (ch === '+') { tokens.push({ type: TokenType.Plus, value: '+', pos: i }); i++; continue; }
		if (ch === '-') { tokens.push({ type: TokenType.Minus, value: '-', pos: i }); i++; continue; }
		if (ch === '*') { tokens.push({ type: TokenType.Star, value: '*', pos: i }); i++; continue; }
		if (ch === '/') { tokens.push({ type: TokenType.Slash, value: '/', pos: i }); i++; continue; }
		if (ch === '%') { tokens.push({ type: TokenType.Percent, value: '%', pos: i }); i++; continue; }
		if (ch === '<') { tokens.push({ type: TokenType.Lt, value: '<', pos: i }); i++; continue; }
		if (ch === '>') { tokens.push({ type: TokenType.Gt, value: '>', pos: i }); i++; continue; }
		if (ch === '!') { tokens.push({ type: TokenType.Not, value: '!', pos: i }); i++; continue; }
		if (ch === '|') { tokens.push({ type: TokenType.Pipe, value: '|', pos: i }); i++; continue; }

		// Identifiers (a-z, A-Z, 0-9, _, -)
		if (/[a-zA-Z_]/.test(ch)) {
			const start = i;
			while (i < input.length && /[a-zA-Z0-9_-]/.test(input[i])) i++;
			tokens.push({ type: TokenType.Identifier, value: input.slice(start, i), pos: start });
			continue;
		}

		// Skip unknown characters
		i++;
	}

	tokens.push({ type: TokenType.EOF, value: '', pos: i });
	return tokens;
}

// ---------------------------------------------------------------------------
// AST nodes
// ---------------------------------------------------------------------------

interface NumberLiteral { type: "number"; value: number; }
interface StringLiteral { type: "string"; value: string; }
interface BooleanLiteral { type: "boolean"; value: boolean; }
interface NullLiteral { type: "null"; }
interface Identifier { type: "identifier"; name: string; }
interface ArrayAccess { type: "arrayAccess"; object: ASTNode; index: ASTNode; }
interface FunctionCall { type: "functionCall"; name: string; args: ASTNode[]; }
interface MethodCall { type: "methodCall"; object: ASTNode; method: string; args: ASTNode[]; }
interface PropertyAccess { type: "propertyAccess"; object: ASTNode; property: string; }
interface BinaryOp { type: "binaryOp"; op: string; left: ASTNode; right: ASTNode; }
interface UnaryOp { type: "unaryOp"; op: string; operand: ASTNode; }
interface ArrayLiteral { type: "arrayLiteral"; elements: ASTNode[]; }
// Lambda-like expression for filter/map callbacks: `value > 2`
interface LambdaExpr { type: "lambda"; body: ASTNode; param: string; }

type ASTNode =
	| NumberLiteral
	| StringLiteral
	| BooleanLiteral
	| NullLiteral
	| Identifier
	| ArrayAccess
	| FunctionCall
	| MethodCall
	| PropertyAccess
	| BinaryOp
	| UnaryOp
	| ArrayLiteral
	| LambdaExpr;

// ---------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------

class Parser {
	private tokens: Token[];
	private pos: number;

	constructor(tokens: Token[]) {
		this.tokens = tokens;
		this.pos = 0;
	}

	private peek(): Token {
		return this.tokens[this.pos];
	}

	private advance(): Token {
		const tok = this.tokens[this.pos];
		this.pos++;
		return tok;
	}

	private expect(type: TokenType): Token {
		const tok = this.peek();
		if (tok.type !== type) {
			throw new Error(`Expected ${TokenType[type]} but got ${TokenType[tok.type]} ("${tok.value}") at pos ${tok.pos}`);
		}
		return this.advance();
	}

	parse(): ASTNode {
		const node = this.parseExpression();
		return node;
	}

	// Expression → Or
	private parseExpression(): ASTNode {
		return this.parseOr();
	}

	// Or → And (|| And)*
	private parseOr(): ASTNode {
		let left = this.parseAnd();
		while (this.peek().type === TokenType.Or) {
			this.advance();
			const right = this.parseAnd();
			left = { type: "binaryOp", op: "||", left, right };
		}
		return left;
	}

	// And → Equality (&& Equality)*
	private parseAnd(): ASTNode {
		let left = this.parseEquality();
		while (this.peek().type === TokenType.And) {
			this.advance();
			const right = this.parseEquality();
			left = { type: "binaryOp", op: "&&", left, right };
		}
		return left;
	}

	// Equality → Comparison (==|!= Comparison)*
	private parseEquality(): ASTNode {
		let left = this.parseComparison();
		while (this.peek().type === TokenType.Eq || this.peek().type === TokenType.Neq) {
			const op = this.advance().value;
			const right = this.parseComparison();
			left = { type: "binaryOp", op, left, right };
		}
		return left;
	}

	// Comparison → Addition (<|>|<=|>= Addition)*
	private parseComparison(): ASTNode {
		let left = this.parseAddition();
		while (
			this.peek().type === TokenType.Lt ||
			this.peek().type === TokenType.Gt ||
			this.peek().type === TokenType.Lte ||
			this.peek().type === TokenType.Gte
		) {
			const op = this.advance().value;
			const right = this.parseAddition();
			left = { type: "binaryOp", op, left, right };
		}
		return left;
	}

	// Addition → Multiplication (+|- Multiplication)*
	private parseAddition(): ASTNode {
		let left = this.parseMultiplication();
		while (this.peek().type === TokenType.Plus || this.peek().type === TokenType.Minus) {
			const op = this.advance().value;
			const right = this.parseMultiplication();
			left = { type: "binaryOp", op, left, right };
		}
		return left;
	}

	// Multiplication → Power (*|/|% Power)*
	private parseMultiplication(): ASTNode {
		let left = this.parsePower();
		while (
			this.peek().type === TokenType.Star ||
			this.peek().type === TokenType.Slash ||
			this.peek().type === TokenType.Percent
		) {
			const op = this.advance().value;
			const right = this.parsePower();
			left = { type: "binaryOp", op, left, right };
		}
		return left;
	}

	// Power → Unary (** Unary)*
	private parsePower(): ASTNode {
		let left = this.parseUnary();
		while (this.peek().type === TokenType.Power) {
			this.advance();
			const right = this.parseUnary();
			left = { type: "binaryOp", op: "**", left, right };
		}
		return left;
	}

	// Unary → !Unary | -Unary | Postfix
	private parseUnary(): ASTNode {
		if (this.peek().type === TokenType.Not) {
			this.advance();
			const operand = this.parseUnary();
			return { type: "unaryOp", op: "!", operand };
		}
		if (this.peek().type === TokenType.Minus) {
			this.advance();
			const operand = this.parseUnary();
			return { type: "unaryOp", op: "-", operand };
		}
		return this.parsePostfix();
	}

	// Postfix → Primary (.method(args) | .property | [index])*
	private parsePostfix(): ASTNode {
		let node = this.parsePrimary();

		while (true) {
			if (this.peek().type === TokenType.Dot) {
				this.advance();
				const name = this.expect(TokenType.Identifier).value;
				if (this.peek().type === TokenType.LParen) {
					// Method call
					this.advance(); // (
					const args = this.parseArgList();
					this.expect(TokenType.RParen);
					node = { type: "methodCall", object: node, method: name, args };
				} else {
					// Property access
					node = { type: "propertyAccess", object: node, property: name };
				}
			} else if (this.peek().type === TokenType.LBracket) {
				this.advance(); // [
				const index = this.parseExpression();
				this.expect(TokenType.RBracket);
				node = { type: "arrayAccess", object: node, index };
			} else {
				break;
			}
		}

		return node;
	}

	// Primary → Number | String | Boolean | null | Identifier | FunctionCall | (Expr) | [elements]
	private parsePrimary(): ASTNode {
		const tok = this.peek();

		if (tok.type === TokenType.Number) {
			this.advance();
			return { type: "number", value: parseFloat(tok.value) };
		}

		if (tok.type === TokenType.String) {
			this.advance();
			return { type: "string", value: tok.value };
		}

		if (tok.type === TokenType.Identifier) {
			if (tok.value === "true") {
				this.advance();
				return { type: "boolean", value: true };
			}
			if (tok.value === "false") {
				this.advance();
				return { type: "boolean", value: false };
			}
			if (tok.value === "null") {
				this.advance();
				return { type: "null" };
			}

			this.advance();
			// Check if function call
			if (this.peek().type === TokenType.LParen) {
				this.advance(); // (
				const args = this.parseArgList();
				this.expect(TokenType.RParen);
				return { type: "functionCall", name: tok.value, args };
			}

			return { type: "identifier", name: tok.value };
		}

		if (tok.type === TokenType.LParen) {
			this.advance();
			const expr = this.parseExpression();
			this.expect(TokenType.RParen);
			return expr;
		}

		if (tok.type === TokenType.LBracket) {
			this.advance();
			const elements: ASTNode[] = [];
			if (this.peek().type !== TokenType.RBracket) {
				elements.push(this.parseExpression());
				while (this.peek().type === TokenType.Comma) {
					this.advance();
					elements.push(this.parseExpression());
				}
			}
			this.expect(TokenType.RBracket);
			return { type: "arrayLiteral", elements };
		}

		throw new Error(`Unexpected token: ${TokenType[tok.type]} ("${tok.value}") at pos ${tok.pos}`);
	}

	private parseArgList(): ASTNode[] {
		const args: ASTNode[] = [];
		if (this.peek().type === TokenType.RParen) return args;
		args.push(this.parseExpression());
		while (this.peek().type === TokenType.Comma) {
			this.advance();
			args.push(this.parseExpression());
		}
		return args;
	}
}

export function parseExpression(input: string): ASTNode {
	const tokens = tokenize(input);
	const parser = new Parser(tokens);
	return parser.parse();
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/** Check if a value is "truthy" in the expression engine sense */
function isTruthy(val: ExprValue): boolean {
	if (val === null || val === undefined || val === false) return false;
	if (val === 0 || val === "") return false;
	if (Array.isArray(val) && val.length === 0) return false;
	return true;
}

/** Convert ExprValue to a number for arithmetic */
function toNumber(val: ExprValue): number {
	if (typeof val === "number") return val;
	if (typeof val === "string") {
		const n = parseFloat(val);
		return isNaN(n) ? 0 : n;
	}
	if (typeof val === "boolean") return val ? 1 : 0;
	return 0;
}

/** Convert ExprValue to string */
function exprToString(val: ExprValue): string {
	if (val === null || val === undefined) return "";
	if (typeof val === "string") return val;
	if (typeof val === "number" || typeof val === "boolean") return String(val);
	if (Array.isArray(val)) return val.map(v => exprToString(v)).join(", ");
	if (isExprFile(val)) return val.path;
	if (isExprLink(val)) return val.display ? `[[${val.target}|${val.display}]]` : `[[${val.target}]]`;
	if (isExprDate(val)) return val._moment.format("YYYY-MM-DD");
	if (typeof val === "object") return JSON.stringify(val);
	return String(val);
}

function isExprFile(val: ExprValue): val is ExprFile {
	return val !== null && typeof val === "object" && !Array.isArray(val) && (val as Record<string, unknown>).__type === "file";
}

function isExprLink(val: ExprValue): val is ExprLink {
	return val !== null && typeof val === "object" && !Array.isArray(val) && (val as Record<string, unknown>).__type === "link";
}

function isExprDate(val: ExprValue): val is ExprDate {
	return val !== null && typeof val === "object" && !Array.isArray(val) && (val as Record<string, unknown>).__type === "date";
}

/** Extract wikilink target from a string */
function extractLinkTarget(value: string): string | null {
	const match = value.trim().match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
	return match ? match[1].trim() : null;
}

/** Resolve a TFile from a link target or filename */
async function resolveToFile(app: App, target: string, sourcePath: string): Promise<TFile | null> {
	return app.metadataCache.getFirstLinkpathDest(target, sourcePath);
}

/** Build an ExprFile wrapper from a TFile */
async function buildExprFile(app: App, tfile: TFile): Promise<ExprFile> {
	const cache = app.metadataCache.getFileCache(tfile);
	const fm = cache?.frontmatter;
	const tags = (cache?.tags?.map(t => t.tag) ?? []);
	// Also include frontmatter tags
	if (fm?.tags) {
		const fmTags = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
		for (const t of fmTags) {
			const tag = String(t).startsWith('#') ? String(t) : `#${t}`;
			if (!tags.includes(tag)) tags.push(tag);
		}
	}
	const links = cache?.links?.map(l => l.link) ?? [];

	const properties: Record<string, ExprValue> = {};
	if (fm) {
		for (const [k, v] of Object.entries(fm)) {
			if (k !== "position") {
				properties[k] = v as ExprValue;
			}
		}
	}

	const folder = tfile.path.includes('/') ? tfile.path.substring(0, tfile.path.lastIndexOf('/')) : '';

	return {
		__type: "file",
		name: tfile.name,
		basename: tfile.basename,
		path: tfile.path,
		folder,
		ext: tfile.extension,
		size: tfile.stat.size,
		ctime: tfile.stat.ctime,
		mtime: tfile.stat.mtime,
		tags,
		links,
		properties,
		_tfile: tfile,
	};
}

/** Read body content of a file (strips frontmatter) */
async function readFileContent(app: App, tfile: TFile): Promise<string> {
	const raw = await app.vault.cachedRead(tfile);
	const cache = app.metadataCache.getFileCache(tfile);
	const fm = cache?.frontmatter;
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
	const endOffset = (fm as any)?.position?.end?.offset;
	if (typeof endOffset === "number") {
		return raw.substring(endOffset).trim();
	}
	return raw;
}

// ---------------------------------------------------------------------------
// Global functions registry
// ---------------------------------------------------------------------------

type GlobalFn = (ctx: ExprContext, args: ExprValue[]) => Promise<ExprValue> | ExprValue;

const globalFunctions: Record<string, GlobalFn> = {
	// --- Link / File ---
	link: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		const target = exprToString(args[0]);
		const display = args.length > 1 ? exprToString(args[1]) : undefined;
		return { __type: "link", target, display };
	},

	file: async (ctx: ExprContext, args: ExprValue[]): Promise<ExprValue> => {
		const target = exprToString(args[0]);
		const tfile = await resolveToFile(ctx.app, target, ctx.file.path);
		if (!tfile) return null;
		return buildExprFile(ctx.app, tfile);
	},

	// --- Conditionals ---
	if: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		const condition = args[0];
		const thenVal = args.length > 1 ? args[1] : true;
		const elseVal = args.length > 2 ? args[2] : null;
		return isTruthy(condition) ? thenVal : elseVal;
	},

	// for(list, template) — iterate over list, return array of results
	// template is a string with {{value}} and {{index}} placeholders
	for: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		const list = args[0];
		const template = args.length > 1 ? exprToString(args[1]) : "{{value}}";
		const separator = args.length > 2 ? exprToString(args[2]) : ", ";
		if (!Array.isArray(list)) return exprToString(list);
		const results = list.map((item, idx) => {
			let result = template;
			result = result.replace(/\{\{value\}\}/g, exprToString(item));
			result = result.replace(/\{\{index\}\}/g, String(idx));
			return result;
		});
		return results.join(separator);
	},

	// --- Date/Time ---
	now: (): ExprValue => {
		return { __type: "date", _moment: moment() };
	},

	today: (): ExprValue => {
		return { __type: "date", _moment: moment().startOf('day') };
	},

	date: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		const input = exprToString(args[0]);
		const format = args.length > 1 ? exprToString(args[1]) : undefined;
		const m = format ? moment(input, format) : moment(input);
		if (!m.isValid()) return null;
		return { __type: "date", _moment: m };
	},

	duration: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		const input = args[0];
		if (typeof input === "number") {
			return { __type: "date", _moment: moment.duration(input) as unknown as moment.Moment };
		}
		const str = exprToString(input);
		const dur = moment.duration(str);
		return dur.asMilliseconds();
	},

	// --- Math ---
	min: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		const nums = args.map(toNumber);
		return Math.min(...nums);
	},

	max: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		const nums = args.map(toNumber);
		return Math.max(...nums);
	},

	random: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		if (args.length >= 2) {
			const min = toNumber(args[0]);
			const max = toNumber(args[1]);
			return Math.floor(Math.random() * (max - min + 1)) + min;
		}
		return Math.random();
	},

	// --- Type constructors ---
	list: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		return args;
	},

	number: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		return toNumber(args[0]);
	},

	// --- HTML / Display ---
	image: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		const src = exprToString(args[0]);
		const alt = args.length > 1 ? exprToString(args[1]) : "";
		return `![${alt}](${src})`;
	},

	icon: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		const name = exprToString(args[0]);
		return `<span class="icon">${name}</span>`;
	},

	html: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		return exprToString(args[0]);
	},

	escapeHTML: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		const str = exprToString(args[0]);
		return str
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	},

	// --- Utility ---
	length: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		const val = args[0];
		if (Array.isArray(val)) return val.length;
		if (typeof val === "string") return val.length;
		return 0;
	},

	typeof: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		const val = args[0];
		if (val === null || val === undefined) return "null";
		if (Array.isArray(val)) return "list";
		if (isExprFile(val)) return "file";
		if (isExprLink(val)) return "link";
		if (isExprDate(val)) return "date";
		if (typeof val === "object") return "object";
		return typeof val;
	},

	// --- String ---
	concat: (_ctx: ExprContext, args: ExprValue[]): ExprValue => {
		return args.map(a => exprToString(a)).join("");
	},
};

// ---------------------------------------------------------------------------
// Method dispatch
// ---------------------------------------------------------------------------

type MethodFn = (ctx: ExprContext, obj: ExprValue, args: ExprValue[]) => Promise<ExprValue> | ExprValue;

/** String methods */
const stringMethods: Record<string, MethodFn> = {
	contains: (_ctx, obj, args) => exprToString(obj).includes(exprToString(args[0])),
	containsAll: (_ctx, obj, args) => {
		const s = exprToString(obj);
		if (Array.isArray(args[0])) return (args[0] as ExprValue[]).every(a => s.includes(exprToString(a)));
		return args.every(a => s.includes(exprToString(a)));
	},
	containsAny: (_ctx, obj, args) => {
		const s = exprToString(obj);
		if (Array.isArray(args[0])) return (args[0] as ExprValue[]).some(a => s.includes(exprToString(a)));
		return args.some(a => s.includes(exprToString(a)));
	},
	endsWith: (_ctx, obj, args) => exprToString(obj).endsWith(exprToString(args[0])),
	startsWith: (_ctx, obj, args) => exprToString(obj).startsWith(exprToString(args[0])),
	isEmpty: (_ctx, obj) => exprToString(obj).length === 0,
	lower: (_ctx, obj) => exprToString(obj).toLowerCase(),
	upper: (_ctx, obj) => exprToString(obj).toUpperCase(),
	title: (_ctx, obj) => exprToString(obj).replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()),
	capitalize: (_ctx, obj) => {
		const s = exprToString(obj);
		return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
	},
	trim: (_ctx, obj) => exprToString(obj).trim(),
	replace: (_ctx, obj, args) => {
		const search = exprToString(args[0]);
		const replaceWith = args.length > 1 ? exprToString(args[1]) : "";
		return exprToString(obj).replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replaceWith);
	},
	repeat: (_ctx, obj, args) => exprToString(obj).repeat(toNumber(args[0])),
	reverse: (_ctx, obj) => exprToString(obj).split('').reverse().join(''),
	slice: (_ctx, obj, args) => {
		const start = toNumber(args[0]);
		const end = args.length > 1 ? toNumber(args[1]) : undefined;
		return exprToString(obj).slice(start, end);
	},
	split: (_ctx, obj, args) => {
		const sep = args.length > 0 ? exprToString(args[0]) : ",";
		return exprToString(obj).split(sep);
	},
	length: (_ctx, obj) => exprToString(obj).length,
	toString: (_ctx: ExprContext, obj: ExprValue) => exprToString(obj),
	isTruthy: (_ctx: ExprContext, obj: ExprValue) => isTruthy(obj),
	isType: (_ctx: ExprContext, obj: ExprValue, args: ExprValue[]) => {
		const expected = exprToString(args[0]);
		return typeof obj === expected;
	},
};

/** Number methods */
const numberMethods: Record<string, MethodFn> = {
	abs: (_ctx, obj) => Math.abs(toNumber(obj)),
	ceil: (_ctx, obj) => Math.ceil(toNumber(obj)),
	floor: (_ctx, obj) => Math.floor(toNumber(obj)),
	round: (_ctx, obj, args) => {
		const n = toNumber(obj);
		const decimals = args.length > 0 ? toNumber(args[0]) : 0;
		const factor = Math.pow(10, decimals);
		return Math.round(n * factor) / factor;
	},
	toFixed: (_ctx, obj, args) => {
		const n = toNumber(obj);
		const decimals = args.length > 0 ? toNumber(args[0]) : 0;
		return n.toFixed(decimals);
	},
	isEmpty: (_ctx, obj) => obj === null || obj === undefined,
	toString: (_ctx: ExprContext, obj: ExprValue) => exprToString(obj),
	isTruthy: (_ctx: ExprContext, obj: ExprValue) => isTruthy(obj),
	isType: (_ctx: ExprContext, _obj: ExprValue, args: ExprValue[]) => {
		const expected = exprToString(args[0]);
		return expected === "number";
	},
};

/** List/array methods */
const listMethods: Record<string, MethodFn> = {
	contains: (_ctx, obj, args) => {
		if (!Array.isArray(obj)) return false;
		const target = args[0];
		return obj.some(item => exprToString(item) === exprToString(target));
	},
	containsAll: (_ctx, obj, args) => {
		if (!Array.isArray(obj)) return false;
		const targets = Array.isArray(args[0]) ? args[0] as ExprValue[] : args;
		return targets.every(t => obj.some(item => exprToString(item) === exprToString(t)));
	},
	containsAny: (_ctx, obj, args) => {
		if (!Array.isArray(obj)) return false;
		const targets = Array.isArray(args[0]) ? args[0] as ExprValue[] : args;
		return targets.some(t => obj.some(item => exprToString(item) === exprToString(t)));
	},
	filter: async (ctx, obj, args) => {
		if (!Array.isArray(obj)) return obj;
		if (args.length === 0) return obj.filter(v => isTruthy(v));
		// args[0] should be an expression AST evaluated per-item
		// For now, support callback-style: filter with a comparison value
		const filterVal = args[0];
		if (typeof filterVal === "string") {
			return obj.filter(item => exprToString(item).includes(filterVal));
		}
		return obj.filter(item => isTruthy(item));
	},
	flat: (_ctx, obj) => {
		if (!Array.isArray(obj)) return obj;
		// Flatten one level
		const result: ExprValue[] = [];
		for (const item of obj) {
			if (Array.isArray(item)) result.push(...item);
			else result.push(item);
		}
		return result;
	},
	isEmpty: (_ctx, obj) => !Array.isArray(obj) || obj.length === 0,
	join: (_ctx, obj, args) => {
		if (!Array.isArray(obj)) return exprToString(obj);
		const sep = args.length > 0 ? exprToString(args[0]) : ", ";
		return obj.map(v => exprToString(v)).join(sep);
	},
	map: async (_ctx, obj, args) => {
		if (!Array.isArray(obj)) return obj;
		// Simple map: extract a property name
		if (args.length > 0 && typeof args[0] === "string") {
			const prop = args[0];
			return obj.map(item => {
				if (item !== null && typeof item === "object" && !Array.isArray(item)) {
					return (item as Record<string, ExprValue>)[prop] ?? null;
				}
				return null;
			});
		}
		return obj;
	},
	reduce: async (_ctx, obj, args) => {
		if (!Array.isArray(obj)) return obj;
		// Simple sum if no args
		if (args.length === 0) {
			return obj.reduce((acc: number, item) => acc + toNumber(item), 0);
		}
		// With initial value
		const initial = args[0];
		return obj.reduce((acc: number, item) => acc + toNumber(item), toNumber(initial));
	},
	reverse: (_ctx, obj) => {
		if (!Array.isArray(obj)) return obj;
		return [...obj].reverse();
	},
	slice: (_ctx, obj, args) => {
		if (!Array.isArray(obj)) return obj;
		const start = toNumber(args[0]);
		const end = args.length > 1 ? toNumber(args[1]) : undefined;
		return obj.slice(start, end);
	},
	sort: (_ctx, obj, args) => {
		if (!Array.isArray(obj)) return obj;
		const arr = [...obj];
		if (args.length > 0 && exprToString(args[0]) === "desc") {
			arr.sort((a, b) => {
				const sa = exprToString(a), sb = exprToString(b);
				return sb.localeCompare(sa);
			});
		} else {
			arr.sort((a, b) => {
				const sa = exprToString(a), sb = exprToString(b);
				return sa.localeCompare(sb);
			});
		}
		return arr;
	},
	unique: (_ctx, obj) => {
		if (!Array.isArray(obj)) return obj;
		const seen = new Set<string>();
		return obj.filter(item => {
			const key = exprToString(item);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	},
	first: (_ctx, obj) => {
		if (!Array.isArray(obj) || obj.length === 0) return null;
		return obj[0];
	},
	last: (_ctx, obj) => {
		if (!Array.isArray(obj) || obj.length === 0) return null;
		return obj[obj.length - 1];
	},
	length: (_ctx, obj) => Array.isArray(obj) ? obj.length : 0,
	toString: (_ctx: ExprContext, obj: ExprValue) => exprToString(obj),
	isTruthy: (_ctx: ExprContext, obj: ExprValue) => isTruthy(obj),
	isType: (_ctx: ExprContext, _obj: ExprValue, args: ExprValue[]) => exprToString(args[0]) === "list",
};

/** Date methods */
const dateMethods: Record<string, MethodFn> = {
	format: (_ctx, obj, args) => {
		if (!isExprDate(obj)) return exprToString(obj);
		const fmt = args.length > 0 ? exprToString(args[0]) : "YYYY-MM-DD";
		return obj._moment.format(fmt);
	},
	date: (_ctx, obj) => {
		if (!isExprDate(obj)) return exprToString(obj);
		return obj._moment.format("YYYY-MM-DD");
	},
	time: (_ctx, obj) => {
		if (!isExprDate(obj)) return exprToString(obj);
		return obj._moment.format("HH:mm:ss");
	},
	relative: (_ctx, obj) => {
		if (!isExprDate(obj)) return exprToString(obj);
		return obj._moment.fromNow();
	},
	year: (_ctx, obj) => isExprDate(obj) ? obj._moment.year() : null,
	month: (_ctx, obj) => isExprDate(obj) ? obj._moment.month() + 1 : null,
	day: (_ctx, obj) => isExprDate(obj) ? obj._moment.date() : null,
	hour: (_ctx, obj) => isExprDate(obj) ? obj._moment.hour() : null,
	minute: (_ctx, obj) => isExprDate(obj) ? obj._moment.minute() : null,
	second: (_ctx, obj) => isExprDate(obj) ? obj._moment.second() : null,
	millisecond: (_ctx, obj) => isExprDate(obj) ? obj._moment.millisecond() : null,
	isEmpty: (_ctx, obj) => !isExprDate(obj) || !obj._moment.isValid(),
	toString: (_ctx: ExprContext, obj: ExprValue) => exprToString(obj),
	isTruthy: (_ctx: ExprContext, obj: ExprValue) => isTruthy(obj),
	isType: (_ctx: ExprContext, _obj: ExprValue, args: ExprValue[]) => exprToString(args[0]) === "date",
};

/** Link methods */
const linkMethods: Record<string, MethodFn> = {
	asFile: async (ctx, obj) => {
		if (!isExprLink(obj)) return null;
		const tfile = await resolveToFile(ctx.app, obj.target, ctx.file.path);
		if (!tfile) return null;
		return buildExprFile(ctx.app, tfile);
	},
	linksTo: async (ctx, obj, args) => {
		if (!isExprLink(obj)) return false;
		const target = exprToString(args[0]);
		// Resolve the link's file and check its links
		const tfile = await resolveToFile(ctx.app, obj.target, ctx.file.path);
		if (!tfile) return false;
		const cache = ctx.app.metadataCache.getFileCache(tfile);
		const links = cache?.links?.map(l => l.link) ?? [];
		return links.includes(target);
	},
	toString: (_ctx: ExprContext, obj: ExprValue) => exprToString(obj),
	isTruthy: (_ctx: ExprContext, obj: ExprValue) => isTruthy(obj),
	isType: (_ctx: ExprContext, _obj: ExprValue, args: ExprValue[]) => exprToString(args[0]) === "link",
};

/** File methods */
const fileMethods: Record<string, MethodFn> = {
	content: async (ctx, obj) => {
		if (!isExprFile(obj)) return null;
		return readFileContent(ctx.app, obj._tfile);
	},
	asLink: (_ctx, obj) => {
		if (!isExprFile(obj)) return null;
		return { __type: "link", target: obj.basename };
	},
	hasLink: (_ctx, obj, args) => {
		if (!isExprFile(obj)) return false;
		const target = exprToString(args[0]);
		return obj.links.includes(target);
	},
	hasProperty: (_ctx, obj, args) => {
		if (!isExprFile(obj)) return false;
		const prop = exprToString(args[0]);
		return prop in obj.properties;
	},
	hasTag: (_ctx, obj, args) => {
		if (!isExprFile(obj)) return false;
		let tag = exprToString(args[0]);
		if (!tag.startsWith('#')) tag = '#' + tag;
		return obj.tags.includes(tag);
	},
	inFolder: (_ctx, obj, args) => {
		if (!isExprFile(obj)) return false;
		const folder = exprToString(args[0]);
		return obj.folder === folder || obj.path.startsWith(folder + '/');
	},
	toString: (_ctx: ExprContext, obj: ExprValue) => exprToString(obj),
	isTruthy: (_ctx: ExprContext, obj: ExprValue) => isTruthy(obj),
	isType: (_ctx: ExprContext, _obj: ExprValue, args: ExprValue[]) => exprToString(args[0]) === "file",
};

/** Object methods */
const objectMethods: Record<string, MethodFn> = {
	isEmpty: (_ctx, obj) => {
		if (obj === null || obj === undefined) return true;
		if (typeof obj === "object" && !Array.isArray(obj)) return Object.keys(obj).length === 0;
		return true;
	},
	keys: (_ctx, obj) => {
		if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
			return Object.keys(obj).filter(k => k !== '__type');
		}
		return [] as ExprValue;
	},
	values: (_ctx, obj) => {
		if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return Object.entries(obj).filter(([k]) => k !== '__type').map(([, v]) => v) as ExprValue;
		}
		return [] as ExprValue;
	},
	toString: (_ctx: ExprContext, obj: ExprValue) => exprToString(obj),
	isTruthy: (_ctx: ExprContext, obj: ExprValue) => isTruthy(obj),
	isType: (_ctx: ExprContext, _obj: ExprValue, args: ExprValue[]) => exprToString(args[0]) === "object",
};

/** Dispatch a method call to the right method table */
async function callMethod(ctx: ExprContext, obj: ExprValue, method: string, args: ExprValue[]): Promise<ExprValue> {
	// Try type-specific methods first
	if (isExprFile(obj) && method in fileMethods) {
		return fileMethods[method](ctx, obj, args);
	}
	if (isExprLink(obj) && method in linkMethods) {
		return linkMethods[method](ctx, obj, args);
	}
	if (isExprDate(obj) && method in dateMethods) {
		return dateMethods[method](ctx, obj, args);
	}
	if (Array.isArray(obj) && method in listMethods) {
		return listMethods[method](ctx, obj, args);
	}
	if (typeof obj === "number" && method in numberMethods) {
		return numberMethods[method](ctx, obj, args);
	}
	if (typeof obj === "string" && method in stringMethods) {
		return stringMethods[method](ctx, obj, args);
	}

	// Fallback: try object methods
	if (method in objectMethods) {
		return objectMethods[method](ctx, obj, args);
	}

	// Try string methods as a fallback for any type
	if (method in stringMethods) {
		return stringMethods[method](ctx, exprToString(obj), args);
	}

	return null;
}

/** Get a property from a typed object */
function getProperty(obj: ExprValue, property: string): ExprValue {
	// ExprFile properties
	if (isExprFile(obj)) {
		if (property in obj && property !== '__type' && property !== '_tfile') {
			return (obj as unknown as Record<string, ExprValue>)[property];
		}
		// Check file's frontmatter properties
		if (property in obj.properties) {
			return obj.properties[property];
		}
		return null;
	}

	// ExprDate properties (year, month, day, etc.)
	if (isExprDate(obj)) {
		switch (property) {
			case "year": return obj._moment.year();
			case "month": return obj._moment.month() + 1;
			case "day": return obj._moment.date();
			case "hour": return obj._moment.hour();
			case "minute": return obj._moment.minute();
			case "second": return obj._moment.second();
			case "millisecond": return obj._moment.millisecond();
		}
		return null;
	}

	// ExprLink properties
	if (isExprLink(obj)) {
		if (property === "target") return obj.target;
		if (property === "display") return obj.display ?? obj.target;
		return null;
	}

	// Array .length
	if (Array.isArray(obj)) {
		if (property === "length") return obj.length;
		return null;
	}

	// String .length
	if (typeof obj === "string") {
		if (property === "length") return obj.length;
		return null;
	}

	// Generic object property access
	if (obj !== null && typeof obj === "object") {
		return (obj as Record<string, ExprValue>)[property] ?? null;
	}

	return null;
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

export async function evaluate(node: ASTNode, ctx: ExprContext): Promise<ExprValue> {
	switch (node.type) {
		case "number":
			return node.value;

		case "string":
			return node.value;

		case "boolean":
			return node.value;

		case "null":
			return null;

		case "identifier": {
			const name = node.name;
			// Check variables first (set by {% set %}, for loops, etc.)
			if (name in ctx.variables) return ctx.variables[name];
			// Then check frontmatter
			if (ctx.frontmatter && name in ctx.frontmatter) {
				return ctx.frontmatter[name] as ExprValue;
			}
			// Built-in file properties
			if (name === "content") return ctx.bodyContent;
			if (name === "name") return ctx.file.name;
			if (name === "basename") return ctx.file.basename;
			if (name === "size") return ctx.file.stat.size;
			if (name === "ctime") return ctx.file.stat.ctime;
			if (name === "mtime") return ctx.file.stat.mtime;
			// Special: "value" for lambda contexts
			return null;
		}

		case "arrayLiteral": {
			const elements: ExprValue[] = [];
			for (const el of node.elements) {
				elements.push(await evaluate(el, ctx));
			}
			return elements;
		}

		case "arrayAccess": {
			const obj = await evaluate(node.object, ctx);
			const index = await evaluate(node.index, ctx);
			if (Array.isArray(obj) && typeof index === "number") {
				return index < obj.length ? obj[index] : null;
			}
			if (typeof obj === "string" && typeof index === "number") {
				return index < obj.length ? obj[index] : null;
			}
			if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
				return (obj as Record<string, ExprValue>)[exprToString(index)] ?? null;
			}
			return null;
		}

		case "functionCall": {
			const fn = globalFunctions[node.name];
			if (!fn) {
				// Maybe it's a frontmatter property that looks like a function call?
				// Return null for unknown functions
				return null;
			}
			const args: ExprValue[] = [];
			for (const arg of node.args) {
				args.push(await evaluate(arg, ctx));
			}
			return fn(ctx, args);
		}

		case "methodCall": {
			const obj = await evaluate(node.object, ctx);
			const args: ExprValue[] = [];
			for (const arg of node.args) {
				args.push(await evaluate(arg, ctx));
			}
			return callMethod(ctx, obj, node.method, args);
		}

		case "propertyAccess": {
			const obj = await evaluate(node.object, ctx);
			if (obj === null || obj === undefined) return null;

			const val = getProperty(obj, node.property);

			// If property returned null, try resolving through wiki-links
			// (cross-file property access like link resolving)
			if (val === null && typeof obj === "string") {
				// Maybe it's a wiki-link value and the property is on the linked file
				const linkTarget = extractLinkTarget(obj);
				if (linkTarget) {
					const tfile = await resolveToFile(ctx.app, linkTarget, ctx.file.path);
					if (tfile) {
						const exprFile = await buildExprFile(ctx.app, tfile);
						return getProperty(exprFile, node.property);
					}
				}
			}

			return val;
		}

		case "binaryOp": {
			const left = await evaluate(node.left, ctx);
			const right = await evaluate(node.right, ctx);

			switch (node.op) {
				case "+": {
					if (typeof left === "string" || typeof right === "string") {
						return exprToString(left) + exprToString(right);
					}
					return toNumber(left) + toNumber(right);
				}
				case "-": return toNumber(left) - toNumber(right);
				case "*": return toNumber(left) * toNumber(right);
				case "/": {
					const d = toNumber(right);
					return d === 0 ? null : toNumber(left) / d;
				}
				case "%": {
					const d = toNumber(right);
					return d === 0 ? null : toNumber(left) % d;
				}
				case "**": return Math.pow(toNumber(left), toNumber(right));
				case "==": return exprToString(left) === exprToString(right);
				case "!=": return exprToString(left) !== exprToString(right);
				case "<": return toNumber(left) < toNumber(right);
				case ">": return toNumber(left) > toNumber(right);
				case "<=": return toNumber(left) <= toNumber(right);
				case ">=": return toNumber(left) >= toNumber(right);
				case "&&": return isTruthy(left) ? right : left;
				case "||": return isTruthy(left) ? left : right;
				default: return null;
			}
		}

		case "unaryOp": {
			const operand = await evaluate(node.operand, ctx);
			switch (node.op) {
				case "!": return !isTruthy(operand);
				case "-": return -toNumber(operand);
				default: return null;
			}
		}

		case "lambda":
			// Lambda expressions are not directly evaluated — they're used
			// inside higher-order methods (filter, map, etc.)
			return null;
	}
}

// ---------------------------------------------------------------------------
// Clipper-style logic block processor
// ---------------------------------------------------------------------------

/**
 * Process Clipper-style logic blocks: {% if %}, {% for %}, {% set %}
 * This runs BEFORE expression/template resolution so that the blocks
 * can control which parts of the template are rendered.
 */
export async function processLogicBlocks(
	template: string,
	ctx: ExprContext
): Promise<string> {
	let result = template;

	// Process {% set %} blocks first
	result = await processSetBlocks(result, ctx);

	// Process {% for %} blocks (must be before if, since for can contain if)
	result = await processForBlocks(result, ctx);

	// Process {% if %} blocks
	result = await processIfBlocks(result, ctx);

	return result;
}

/** Process {% set variable = expression %} */
async function processSetBlocks(template: string, ctx: ExprContext): Promise<string> {
	const setRegex = /\{%\s*set\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*?)\s*%\}/g;
	let result = template;
	let match;
	while ((match = setRegex.exec(result)) !== null) {
		const varName = match[1];
		const exprStr = match[2];
		try {
			const ast = parseExpression(exprStr);
			const value = await evaluate(ast, ctx);
			ctx.variables[varName] = value;
		} catch {
			ctx.variables[varName] = exprStr;
		}
		// Remove the {% set %} block from output
		result = result.substring(0, match.index) + result.substring(match.index + match[0].length);
		setRegex.lastIndex = match.index;
	}
	return result;
}

/** Process {% for item in list %}...{% endfor %} */
async function processForBlocks(template: string, ctx: ExprContext): Promise<string> {
	// Find innermost {% for %} blocks first (no nesting inside)
	const forRegex = /\{%\s*for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+(.*?)\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g;
	let result = template;
	let safety = 0;

	while (forRegex.test(result) && safety < 50) {
		safety++;
		forRegex.lastIndex = 0;
		result = await replaceAsync(result, forRegex, async (_fullMatch, varName: string, listExpr: string, body: string) => {
			let list: ExprValue;
			try {
				const ast = parseExpression(listExpr);
				list = await evaluate(ast, ctx);
			} catch {
				// Try as a simple identifier in frontmatter
				if (ctx.frontmatter && listExpr.trim() in ctx.frontmatter) {
					list = ctx.frontmatter[listExpr.trim()] as ExprValue;
				} else {
					list = null;
				}
			}

			if (!Array.isArray(list)) return "";

			const parts: string[] = [];
			for (let i = 0; i < list.length; i++) {
				const itemCtx: ExprContext = {
					...ctx,
					variables: {
						...ctx.variables,
						[varName]: list[i],
						loop: {
							index: i + 1,
							index0: i,
							first: i === 0,
							last: i === list.length - 1,
							length: list.length,
						},
					},
				};
				parts.push(await processLogicBlocks(body, itemCtx));
			}
			return parts.join("");
		});
	}

	return result;
}

/** Process {% if %}...{% elif %}...{% else %}...{% endif %} */
async function processIfBlocks(template: string, ctx: ExprContext): Promise<string> {
	// Find innermost {% if %} blocks
	const ifRegex = /\{%\s*if\s+(.*?)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
	let result = template;
	let safety = 0;

	while (ifRegex.test(result) && safety < 50) {
		safety++;
		ifRegex.lastIndex = 0;
		result = await replaceAsync(result, ifRegex, async (_fullMatch, condStr: string, innerBlock: string) => {
			// Split into if/elif/else branches
			const branches: { condition: string | null; body: string }[] = [];

			// The first condition is from the if tag itself
			// Split innerBlock by {% elif %} and {% else %}
			const remaining = innerBlock;

			// Extract elif blocks
			const elifRegex = /\{%\s*elif\s+(.*?)\s*%\}/g;
			const elseRegex = /\{%\s*else\s*%\}/g;

			// Collect all split points
			const splitPoints: { index: number; length: number; condition: string | null }[] = [];
			let m2;
			while ((m2 = elifRegex.exec(remaining)) !== null) {
				splitPoints.push({ index: m2.index, length: m2[0].length, condition: m2[1] });
			}
			while ((m2 = elseRegex.exec(remaining)) !== null) {
				splitPoints.push({ index: m2.index, length: m2[0].length, condition: null });
			}
			splitPoints.sort((a, b) => a.index - b.index);

			if (splitPoints.length === 0) {
				branches.push({ condition: condStr, body: remaining });
			} else {
				// First branch: from start to first split
				branches.push({ condition: condStr, body: remaining.substring(0, splitPoints[0].index) });
				for (let i = 0; i < splitPoints.length; i++) {
					const start = splitPoints[i].index + splitPoints[i].length;
					const end = i + 1 < splitPoints.length ? splitPoints[i + 1].index : remaining.length;
					branches.push({ condition: splitPoints[i].condition, body: remaining.substring(start, end) });
				}
			}

			// Evaluate branches in order
			for (const branch of branches) {
				if (branch.condition === null) {
					// {% else %} branch — always true
					return branch.body;
				}
				try {
					const ast = parseExpression(branch.condition);
					const value = await evaluate(ast, ctx);
					if (isTruthy(value)) {
						return branch.body;
					}
				} catch {
					// If condition can't parse, skip this branch
				}
			}

			return ""; // No branch matched
		});
	}

	return result;
}

/** Async replace helper */
async function replaceAsync(
	str: string,
	regex: RegExp,
	asyncFn: (...args: string[]) => Promise<string>
): Promise<string> {
	const matches: { match: RegExpExecArray }[] = [];
	let m;
	const re = new RegExp(regex.source, regex.flags.replace('g', '') + 'g');
	while ((m = re.exec(str)) !== null) {
		matches.push({ match: m });
	}

	if (matches.length === 0) return str;

	const replacements: string[] = [];
	for (const { match: mx } of matches) {
		replacements.push(await asyncFn(...Array.from(mx)));
	}

	// Replace in reverse order
	let result = str;
	for (let i = matches.length - 1; i >= 0; i--) {
		const mx = matches[i].match;
		result = result.substring(0, mx.index) + replacements[i] + result.substring(mx.index + mx[0].length);
	}
	return result;
}

// ---------------------------------------------------------------------------
// Mode detection & public API
// ---------------------------------------------------------------------------

/**
 * Detect whether a template expression (the part inside {{ }}) is in
 * expression mode (Bases-style) or legacy pipe-filter mode.
 *
 * Expression mode is detected by the presence of a `(` before any `|`.
 * Legacy mode: `property | filter1 | filter2`
 * Expression mode: `link(cast[0]).asFile().content()`
 *
 * Mixed: `link(cast[0]).asFile().name | upper` — expression mode with trailing pipes
 */
export function isExpressionMode(expr: string): boolean {
	let inQuote = false;
	let quoteChar = '';
	for (let i = 0; i < expr.length; i++) {
		const ch = expr[i];
		if (!inQuote && (ch === '"' || ch === "'")) {
			inQuote = true;
			quoteChar = ch;
		} else if (inQuote && ch === quoteChar) {
			inQuote = false;
		} else if (!inQuote) {
			if (ch === '(') return true;
			if (ch === '|') return false;
		}
	}
	// If no parens or pipes, check for operators
	if (/[+\-*/<>=!&|]/.test(expr)) return true;
	return false;
}

/**
 * Evaluate an expression string in the given context.
 * Handles both expression mode and separates trailing pipe filters.
 *
 * @param exprStr - The expression string (inside {{ }})
 * @param ctx - Evaluation context
 * @returns The evaluated value as a string
 */
export async function evaluateExpression(exprStr: string, ctx: ExprContext): Promise<ExprValue> {
	// Split off trailing pipe filters (only outside of parens/quotes)
	const { expression, pipeFilters } = splitExpressionAndPipes(exprStr);

	try {
		const ast = parseExpression(expression);
		let result = await evaluate(ast, ctx);

		// Apply trailing pipe filters if present
		if (pipeFilters) {
			const { applyFilterChain } = await import("./filters");
			const filterInput = result as Parameters<typeof applyFilterChain>[0];
			result = applyFilterChain(filterInput, pipeFilters);
		}

		return result;
	} catch (e) {
		console.error(`[Custom Views] Expression error:`, e);
		return null;
	}
}

/**
 * Split an expression string into the core expression and trailing pipe filters.
 * Pipes inside function calls are not treated as filter separators.
 *
 * Example: `link(cast[0]).asFile().name | upper | trim`
 * → expression: `link(cast[0]).asFile().name`
 * → pipeFilters: `upper | trim`
 */
export function splitExpressionAndPipes(input: string): { expression: string; pipeFilters: string | null } {
	let depth = 0;
	let inQuote = false;
	let quoteChar = '';
	let lastPipeOutsideParens = -1;

	// Find the FIRST pipe that's outside all parens and quotes
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (!inQuote && (ch === '"' || ch === "'")) {
			inQuote = true;
			quoteChar = ch;
		} else if (inQuote && ch === quoteChar) {
			inQuote = false;
		} else if (!inQuote) {
			if (ch === '(' || ch === '[') depth++;
			else if (ch === ')' || ch === ']') depth--;
			else if (ch === '|' && depth === 0) {
				// Check it's not || (logical OR)
				if (i + 1 < input.length && input[i + 1] === '|') {
					i++; // skip next |
					continue;
				}
				lastPipeOutsideParens = i;
				break; // Found first pipe outside parens
			}
		}
	}

	if (lastPipeOutsideParens === -1) {
		return { expression: input.trim(), pipeFilters: null };
	}

	return {
		expression: input.substring(0, lastPipeOutsideParens).trim(),
		pipeFilters: input.substring(lastPipeOutsideParens + 1).trim(),
	};
}
