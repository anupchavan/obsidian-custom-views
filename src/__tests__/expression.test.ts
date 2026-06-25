/**
 * Tests for the expression engine (src/expression.ts)
 *
 * Covers:
 *   - Tokenizer
 *   - Parser + AST
 *   - Evaluator (literals, operators, identifiers)
 *   - Global functions (link, file, if, for, now, today, date, min, max, etc.)
 *   - Type methods (String, Number, List, Date, Link, File, Object, Any)
 *   - Mode detection (expression vs legacy)
 *   - splitExpressionAndPipes
 *   - Clipper logic blocks ({% if %}, {% for %}, {% set %})
 *
 * Run with:  npm test
 */

import { describe, it, expect, vi } from "vitest";
import {
	tokenize,
	parseExpression,
	evaluate,
	evaluateExpression,
	isExpressionMode,
	splitExpressionAndPipes,
	processLogicBlocks,
} from "../expression";
import type { ExprContext, ExprFile, ExprLink, ExprDate } from "../expression";
import type { App, TFile } from "obsidian";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockFile(overrides: Partial<TFile> = {}): TFile {
	return {
		name: "test.md",
		basename: "test",
		path: "folder/test.md",
		extension: "md",
		stat: { size: 1234, ctime: 1000000, mtime: 2000000 },
		vault: {},
		...overrides,
		// eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
	} as unknown as TFile;
}

function makeContext(overrides: Partial<ExprContext> = {}): ExprContext {
	const file = makeMockFile();
	return {
		app: {
			metadataCache: {
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
				getFileCache: vi.fn().mockReturnValue(null),
			},
			vault: {
				cachedRead: vi.fn().mockResolvedValue(""),
			},
		} as unknown as App,
		file,
		frontmatter: {},
		bodyContent: "This is the body content",
		variables: {},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

describe("tokenize", () => {
	it("tokenizes numbers", () => {
		const tokens = tokenize("42 3.14");
		expect(tokens[0].value).toBe("42");
		expect(tokens[1].value).toBe("3.14");
	});

	it("tokenizes strings with double quotes", () => {
		const tokens = tokenize('"hello world"');
		expect(tokens[0].value).toBe("hello world");
	});

	it("tokenizes strings with single quotes", () => {
		const tokens = tokenize("'hello'");
		expect(tokens[0].value).toBe("hello");
	});

	it("tokenizes regex literals", () => {
		const tokens = tokenize("title.replace(/.*\\s*–\\s*/i, \"\")");
		const regexToken = tokens.find(token => token.value === ".*\\s*–\\s*");
		expect(regexToken).toBeDefined();
		expect((regexToken as { flags?: string }).flags).toBe("i");
	});

	it("tokenizes escape sequences in strings", () => {
		const tokens = tokenize('"hello\\nworld"');
		expect(tokens[0].value).toBe("hello\nworld");
	});

	it("tokenizes identifiers", () => {
		const tokens = tokenize("foo bar_baz my-var");
		expect(tokens[0].value).toBe("foo");
		expect(tokens[1].value).toBe("bar_baz");
		expect(tokens[2].value).toBe("my-var");
	});

	it("tokenizes operators", () => {
		const tokens = tokenize("+ - * / == != < > <= >= && || **");
		const values = tokens.filter(t => t.value !== '').map(t => t.value);
		expect(values).toEqual(["+", "-", "*", "/", "==", "!=", "<", ">", "<=", ">=", "&&", "||", "**"]);
	});

	it("tokenizes parens, brackets, dots, commas", () => {
		const tokens = tokenize("foo(a[0], b.c)");
		const values = tokens.filter(t => t.value !== '').map(t => t.value);
		expect(values).toEqual(["foo", "(", "a", "[", "0", "]", ",", "b", ".", "c", ")"]);
	});

	it("tokenizes boolean literals", () => {
		const tokens = tokenize("true false");
		expect(tokens[0].value).toBe("true");
		expect(tokens[1].value).toBe("false");
	});
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("parseExpression", () => {
	it("parses a number literal", () => {
		const ast = parseExpression("42");
		expect(ast).toEqual({ type: "number", value: 42 });
	});

	it("parses a string literal", () => {
		const ast = parseExpression('"hello"');
		expect(ast).toEqual({ type: "string", value: "hello" });
	});

	it("parses a boolean literal", () => {
		expect(parseExpression("true")).toEqual({ type: "boolean", value: true });
		expect(parseExpression("false")).toEqual({ type: "boolean", value: false });
	});

	it("parses null", () => {
		expect(parseExpression("null")).toEqual({ type: "null" });
	});

	it("parses an identifier", () => {
		const ast = parseExpression("foo");
		expect(ast).toEqual({ type: "identifier", name: "foo" });
	});

	it("parses a function call", () => {
		const ast = parseExpression("min(1, 2)");
		expect(ast.type).toBe("functionCall");
		if (ast.type === "functionCall") {
			expect(ast.name).toBe("min");
			expect(ast.args).toHaveLength(2);
		}
	});

	it("parses method chaining", () => {
		const ast = parseExpression("foo.bar().baz()");
		expect(ast.type).toBe("methodCall");
	});

	it("parses property access", () => {
		const ast = parseExpression("foo.bar");
		expect(ast).toEqual({
			type: "propertyAccess",
			object: { type: "identifier", name: "foo" },
			property: "bar",
		});
	});

	it("parses array access", () => {
		const ast = parseExpression("foo[0]");
		expect(ast.type).toBe("arrayAccess");
	});

	it("parses binary operations", () => {
		const ast = parseExpression("1 + 2");
		expect(ast.type).toBe("binaryOp");
		if (ast.type === "binaryOp") {
			expect(ast.op).toBe("+");
		}
	});

	it("parses unary negation", () => {
		const ast = parseExpression("-5");
		expect(ast.type).toBe("unaryOp");
	});

	it("parses unary not", () => {
		const ast = parseExpression("!true");
		expect(ast.type).toBe("unaryOp");
	});

	it("parses array literal", () => {
		const ast = parseExpression("[1, 2, 3]");
		expect(ast.type).toBe("arrayLiteral");
	});

	it("parses grouped expressions", () => {
		const ast = parseExpression("(1 + 2) * 3");
		expect(ast.type).toBe("binaryOp");
	});

	it("parses complex chain: link(x).asFile().content()", () => {
		const ast = parseExpression('link("test").asFile().content()');
		expect(ast.type).toBe("methodCall");
		if (ast.type === "methodCall") {
			expect(ast.method).toBe("content");
			expect(ast.object.type).toBe("methodCall");
		}
	});

	it("parses identifier with array access then property access", () => {
		const ast = parseExpression("cast[0].name");
		expect(ast.type).toBe("propertyAccess");
		if (ast.type === "propertyAccess") {
			expect(ast.property).toBe("name");
			expect(ast.object.type).toBe("arrayAccess");
		}
	});

	it("respects operator precedence", () => {
		const ast = parseExpression("1 + 2 * 3");
		expect(ast.type).toBe("binaryOp");
		if (ast.type === "binaryOp") {
			expect(ast.op).toBe("+");
			expect(ast.right.type).toBe("binaryOp");
		}
	});
});

// ---------------------------------------------------------------------------
// Evaluator — basics
// ---------------------------------------------------------------------------

describe("evaluate", () => {
	it("evaluates number literals", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression("42"), ctx)).toBe(42);
	});

	it("evaluates string literals", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('"hello"'), ctx)).toBe("hello");
	});

	it("evaluates boolean literals", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression("true"), ctx)).toBe(true);
		expect(await evaluate(parseExpression("false"), ctx)).toBe(false);
	});

	it("evaluates null", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression("null"), ctx)).toBe(null);
	});

	it("evaluates identifiers from frontmatter", async () => {
		const ctx = makeContext({ frontmatter: { title: "Hello" } });
		expect(await evaluate(parseExpression("title"), ctx)).toBe("Hello");
	});

	it("evaluates identifiers from variables", async () => {
		const ctx = makeContext({ variables: { myVar: "test" } });
		expect(await evaluate(parseExpression("myVar"), ctx)).toBe("test");
	});

	it("variables take precedence over frontmatter", async () => {
		const ctx = makeContext({
			frontmatter: { x: "from-fm" },
			variables: { x: "from-var" },
		});
		expect(await evaluate(parseExpression("x"), ctx)).toBe("from-var");
	});

	it("evaluates built-in file properties", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression("content"), ctx)).toBe("This is the body content");
		expect(await evaluate(parseExpression("name"), ctx)).toBe("test.md");
		expect(await evaluate(parseExpression("basename"), ctx)).toBe("test");
	});

	it("evaluates array literal", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression("[1, 2, 3]"), ctx)).toEqual([1, 2, 3]);
	});

	it("evaluates array access", async () => {
		const ctx = makeContext({ frontmatter: { tags: ["a", "b", "c"] } });
		expect(await evaluate(parseExpression("tags[0]"), ctx)).toBe("a");
		expect(await evaluate(parseExpression("tags[2]"), ctx)).toBe("c");
	});

	it("returns null for out-of-bounds array access", async () => {
		const ctx = makeContext({ frontmatter: { tags: ["a"] } });
		expect(await evaluate(parseExpression("tags[5]"), ctx)).toBe(null);
	});
});

// ---------------------------------------------------------------------------
// Evaluator — arithmetic operators
// ---------------------------------------------------------------------------

describe("evaluate — arithmetic", () => {
	const ctx = makeContext();

	it("addition", async () => {
		expect(await evaluate(parseExpression("3 + 4"), ctx)).toBe(7);
	});

	it("subtraction", async () => {
		expect(await evaluate(parseExpression("10 - 3"), ctx)).toBe(7);
	});

	it("multiplication", async () => {
		expect(await evaluate(parseExpression("6 * 7"), ctx)).toBe(42);
	});

	it("division", async () => {
		expect(await evaluate(parseExpression("10 / 4"), ctx)).toBe(2.5);
	});

	it("division still works after regex literal support", async () => {
		expect(await evaluate(parseExpression("10/2"), ctx)).toBe(5);
	});

	it("division by zero returns null", async () => {
		expect(await evaluate(parseExpression("10 / 0"), ctx)).toBe(null);
	});

	it("modulo", async () => {
		expect(await evaluate(parseExpression("10 % 3"), ctx)).toBe(1);
	});

	it("power", async () => {
		expect(await evaluate(parseExpression("2 ** 10"), ctx)).toBe(1024);
	});

	it("string concatenation with +", async () => {
		expect(await evaluate(parseExpression('"hello" + " " + "world"'), ctx)).toBe("hello world");
	});

	it("unary negation", async () => {
		expect(await evaluate(parseExpression("-5"), ctx)).toBe(-5);
	});
});

// ---------------------------------------------------------------------------
// Evaluator — comparison & logical operators
// ---------------------------------------------------------------------------

describe("evaluate — comparison & logic", () => {
	const ctx = makeContext();

	it("==", async () => {
		expect(await evaluate(parseExpression("1 == 1"), ctx)).toBe(true);
		expect(await evaluate(parseExpression("1 == 2"), ctx)).toBe(false);
	});

	it("!=", async () => {
		expect(await evaluate(parseExpression("1 != 2"), ctx)).toBe(true);
	});

	it("< > <= >=", async () => {
		expect(await evaluate(parseExpression("1 < 2"), ctx)).toBe(true);
		expect(await evaluate(parseExpression("2 > 1"), ctx)).toBe(true);
		expect(await evaluate(parseExpression("2 <= 2"), ctx)).toBe(true);
		expect(await evaluate(parseExpression("3 >= 2"), ctx)).toBe(true);
	});

	it("&&", async () => {
		expect(await evaluate(parseExpression("true && true"), ctx)).toBe(true);
		expect(await evaluate(parseExpression("true && false"), ctx)).toBe(false);
	});

	it("||", async () => {
		expect(await evaluate(parseExpression("false || true"), ctx)).toBe(true);
		expect(await evaluate(parseExpression("false || false"), ctx)).toBe(false);
	});

	it("! (not)", async () => {
		expect(await evaluate(parseExpression("!true"), ctx)).toBe(false);
		expect(await evaluate(parseExpression("!false"), ctx)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Global functions
// ---------------------------------------------------------------------------

describe("global functions", () => {
	it("if() — truthy condition", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('if(true, "yes", "no")'), ctx)).toBe("yes");
	});

	it("if() — falsy condition", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('if(false, "yes", "no")'), ctx)).toBe("no");
	});

	it("if() — with expression condition", async () => {
		const ctx = makeContext({ frontmatter: { rating: 9 } });
		expect(await evaluate(parseExpression('if(rating > 8, "Great", "OK")'), ctx)).toBe("Great");
	});

	it("if() — without else value returns null", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('if(false, "yes")'), ctx)).toBe(null);
	});

	it("for() — iterates over list", async () => {
		const ctx = makeContext({ frontmatter: { items: ["a", "b", "c"] } });
		expect(await evaluate(parseExpression('for(items, "{{value}}")'), ctx)).toBe("a, b, c");
	});

	it("for() — with custom separator", async () => {
		const ctx = makeContext({ frontmatter: { items: ["x", "y"] } });
		expect(await evaluate(parseExpression('for(items, "{{value}}", " | ")'), ctx)).toBe("x | y");
	});

	it("for() — exposes index", async () => {
		const ctx = makeContext({ frontmatter: { items: ["a", "b"] } });
		expect(await evaluate(parseExpression('for(items, "{{index}}")'), ctx)).toBe("0, 1");
	});

	it("min()", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression("min(5, 3, 8, 1)"), ctx)).toBe(1);
	});

	it("max()", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression("max(5, 3, 8, 1)"), ctx)).toBe(8);
	});

	it("list()", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression("list(1, 2, 3)"), ctx)).toEqual([1, 2, 3]);
	});

	it("number()", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('number("42")'), ctx)).toBe(42);
	});

	it("escapeHTML()", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('escapeHTML("<b>hi</b>")'), ctx)).toBe("&lt;b&gt;hi&lt;/b&gt;");
	});

	it("link() — creates a link", async () => {
		const ctx = makeContext();
		const result = await evaluate(parseExpression('link("My Note")'), ctx);
		expect(result).toEqual({ __type: "link", target: "My Note", display: undefined });
	});

	it("link() — with display text", async () => {
		const ctx = makeContext();
		const result = await evaluate(parseExpression('link("My Note", "Click here")'), ctx);
		expect(result).toEqual({ __type: "link", target: "My Note", display: "Click here" });
	});

	it("concat()", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('concat("hello", " ", "world")'), ctx)).toBe("hello world");
	});

	it("length()", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('length("hello")'), ctx)).toBe(5);
		expect(await evaluate(parseExpression('length(list(1,2,3))'), ctx)).toBe(3);
	});

	it("now() — returns a date", async () => {
		const ctx = makeContext();
		const result = await evaluate(parseExpression("now()"), ctx);
		expect(result).not.toBeNull();
		expect(typeof result === "object" && result !== null && (result as Record<string, unknown>).__type === "date").toBe(true);
	});

	it("today() — returns a date", async () => {
		const ctx = makeContext();
		const result = await evaluate(parseExpression("today()"), ctx);
		expect(result).not.toBeNull();
		expect(typeof result === "object" && result !== null && (result as Record<string, unknown>).__type === "date").toBe(true);
	});

	it("date() — parses a date string", async () => {
		const ctx = makeContext();
		const result = await evaluate(parseExpression('date("2024-01-15")'), ctx);
		expect(result).not.toBeNull();
		expect((result as ExprDate).__type).toBe("date");
	});

	it("date() — returns null for invalid date", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('date("not-a-date")'), ctx)).toBe(null);
	});

	it("image()", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('image("pic.png", "My pic")'), ctx)).toBe("![My pic](pic.png)");
	});

	it("image() wraps destinations with spaces", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('image("test 1.png")'), ctx)).toBe("![](<test 1.png>)");
	});

	it("random() — no args returns 0-1", async () => {
		const ctx = makeContext();
		const result = await evaluate(parseExpression("random()"), ctx) as number;
		expect(result).toBeGreaterThanOrEqual(0);
		expect(result).toBeLessThan(1);
	});

	it("random() — with range", async () => {
		const ctx = makeContext();
		const result = await evaluate(parseExpression("random(1, 10)"), ctx) as number;
		expect(result).toBeGreaterThanOrEqual(1);
		expect(result).toBeLessThanOrEqual(10);
	});

	it("typeof()", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('typeof(42)'), ctx)).toBe("number");
		expect(await evaluate(parseExpression('typeof("hi")'), ctx)).toBe("string");
		expect(await evaluate(parseExpression('typeof(true)'), ctx)).toBe("boolean");
		expect(await evaluate(parseExpression('typeof(null)'), ctx)).toBe("null");
		expect(await evaluate(parseExpression('typeof(list(1,2))'), ctx)).toBe("list");
	});

	it("unknown function returns null", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression("unknownFn(1)"), ctx)).toBe(null);
	});
});

// ---------------------------------------------------------------------------
// String methods
// ---------------------------------------------------------------------------

describe("string methods", () => {
	const ctx = makeContext({ frontmatter: { title: "Hello World" } });

	it(".upper()", async () => {
		expect(await evaluate(parseExpression("title.upper()"), ctx)).toBe("HELLO WORLD");
	});

	it(".lower()", async () => {
		expect(await evaluate(parseExpression("title.lower()"), ctx)).toBe("hello world");
	});

	it(".title()", async () => {
		const ctx2 = makeContext({ frontmatter: { title: "hello world" } });
		expect(await evaluate(parseExpression("title.title()"), ctx2)).toBe("Hello World");
	});

	it(".capitalize()", async () => {
		const ctx2 = makeContext({ frontmatter: { title: "hello WORLD" } });
		expect(await evaluate(parseExpression("title.capitalize()"), ctx2)).toBe("Hello world");
	});

	it(".trim()", async () => {
		const ctx2 = makeContext({ frontmatter: { title: "  hello  " } });
		expect(await evaluate(parseExpression("title.trim()"), ctx2)).toBe("hello");
	});

	it(".contains()", async () => {
		expect(await evaluate(parseExpression('title.contains("World")'), ctx)).toBe(true);
		expect(await evaluate(parseExpression('title.contains("xyz")'), ctx)).toBe(false);
	});

	it(".startsWith()", async () => {
		expect(await evaluate(parseExpression('title.startsWith("Hello")'), ctx)).toBe(true);
	});

	it(".endsWith()", async () => {
		expect(await evaluate(parseExpression('title.endsWith("World")'), ctx)).toBe(true);
	});

	it(".isEmpty()", async () => {
		expect(await evaluate(parseExpression("title.isEmpty()"), ctx)).toBe(false);
		const ctx2 = makeContext({ frontmatter: { title: "" } });
		expect(await evaluate(parseExpression("title.isEmpty()"), ctx2)).toBe(true);
	});

	it(".replace()", async () => {
		expect(await evaluate(parseExpression('title.replace("World", "There")'), ctx)).toBe("Hello There");
	});

	it(".replace() with regex literal", async () => {
		const ctx2 = makeContext({ frontmatter: { title: "Ritviz – Mimmi" } });
		expect(await evaluate(parseExpression('title.replace(/.*\\s*–\\s*/, "")'), ctx2)).toBe("Mimmi");
	});

	it(".replace() with regex flags", async () => {
		const ctx2 = makeContext({ frontmatter: { title: "Mimmi MIMMI" } });
		expect(await evaluate(parseExpression('title.replace(/mimmi/gi, "Album")'), ctx2)).toBe("Album Album");
	});

	it(".repeat()", async () => {
		const ctx2 = makeContext({ frontmatter: { x: "ab" } });
		expect(await evaluate(parseExpression("x.repeat(3)"), ctx2)).toBe("ababab");
	});

	it(".reverse()", async () => {
		const ctx2 = makeContext({ frontmatter: { x: "abc" } });
		expect(await evaluate(parseExpression("x.reverse()"), ctx2)).toBe("cba");
	});

	it(".slice()", async () => {
		expect(await evaluate(parseExpression("title.slice(0, 5)"), ctx)).toBe("Hello");
	});

	it(".split()", async () => {
		expect(await evaluate(parseExpression('title.split(" ")'), ctx)).toEqual(["Hello", "World"]);
	});

	it(".length", async () => {
		expect(await evaluate(parseExpression("title.length"), ctx)).toBe(11);
	});

	it(".containsAll()", async () => {
		expect(await evaluate(parseExpression('title.containsAll("Hello", "World")'), ctx)).toBe(true);
		expect(await evaluate(parseExpression('title.containsAll("Hello", "xyz")'), ctx)).toBe(false);
	});

	it(".containsAny()", async () => {
		expect(await evaluate(parseExpression('title.containsAny("Hello", "xyz")'), ctx)).toBe(true);
		expect(await evaluate(parseExpression('title.containsAny("abc", "xyz")'), ctx)).toBe(false);
	});

	it(".toString()", async () => {
		expect(await evaluate(parseExpression("title.toString()"), ctx)).toBe("Hello World");
	});

	it(".isTruthy()", async () => {
		expect(await evaluate(parseExpression("title.isTruthy()"), ctx)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Number methods
// ---------------------------------------------------------------------------

describe("number methods", () => {
	const ctx = makeContext({ frontmatter: { val: 3.7, neg: -5.2 } });

	it(".abs()", async () => {
		expect(await evaluate(parseExpression("neg.abs()"), ctx)).toBe(5.2);
	});

	it(".ceil()", async () => {
		expect(await evaluate(parseExpression("val.ceil()"), ctx)).toBe(4);
	});

	it(".floor()", async () => {
		expect(await evaluate(parseExpression("val.floor()"), ctx)).toBe(3);
	});

	it(".round()", async () => {
		expect(await evaluate(parseExpression("val.round()"), ctx)).toBe(4);
	});

	it(".round() with decimals", async () => {
		const ctx2 = makeContext({ frontmatter: { val: 3.14159 } });
		expect(await evaluate(parseExpression("val.round(2)"), ctx2)).toBe(3.14);
	});

	it(".toFixed()", async () => {
		expect(await evaluate(parseExpression("val.toFixed(1)"), ctx)).toBe("3.7");
	});
});

// ---------------------------------------------------------------------------
// List methods
// ---------------------------------------------------------------------------

describe("list methods", () => {
	const ctx = makeContext({ frontmatter: { items: ["c", "a", "b", "a"] } });

	it(".contains()", async () => {
		expect(await evaluate(parseExpression('items.contains("a")'), ctx)).toBe(true);
		expect(await evaluate(parseExpression('items.contains("z")'), ctx)).toBe(false);
	});

	it(".join()", async () => {
		expect(await evaluate(parseExpression('items.join(", ")'), ctx)).toBe("c, a, b, a");
	});

	it(".join() default separator", async () => {
		expect(await evaluate(parseExpression("items.join()"), ctx)).toBe("c, a, b, a");
	});

	it(".sort()", async () => {
		expect(await evaluate(parseExpression("items.sort()"), ctx)).toEqual(["a", "a", "b", "c"]);
	});

	it('.sort("desc")', async () => {
		expect(await evaluate(parseExpression('items.sort("desc")'), ctx)).toEqual(["c", "b", "a", "a"]);
	});

	it(".unique()", async () => {
		expect(await evaluate(parseExpression("items.unique()"), ctx)).toEqual(["c", "a", "b"]);
	});

	it(".reverse()", async () => {
		expect(await evaluate(parseExpression("items.reverse()"), ctx)).toEqual(["a", "b", "a", "c"]);
	});

	it(".first()", async () => {
		expect(await evaluate(parseExpression("items.first()"), ctx)).toBe("c");
	});

	it(".last()", async () => {
		expect(await evaluate(parseExpression("items.last()"), ctx)).toBe("a");
	});

	it(".slice()", async () => {
		expect(await evaluate(parseExpression("items.slice(1, 3)"), ctx)).toEqual(["a", "b"]);
	});

	it(".length", async () => {
		expect(await evaluate(parseExpression("items.length"), ctx)).toBe(4);
	});

	it(".isEmpty() — non-empty", async () => {
		expect(await evaluate(parseExpression("items.isEmpty()"), ctx)).toBe(false);
	});

	it(".isEmpty() — empty", async () => {
		const ctx2 = makeContext({ frontmatter: { items: [] } });
		expect(await evaluate(parseExpression("items.isEmpty()"), ctx2)).toBe(true);
	});

	it(".flat()", async () => {
		const ctx2 = makeContext({ frontmatter: { nested: [["a", "b"], ["c"]] as unknown } });
		const result = await evaluate(parseExpression("nested.flat()"), ctx2);
		expect(result).toEqual(["a", "b", "c"]);
	});

	it(".reduce() — sum", async () => {
		const ctx2 = makeContext({ frontmatter: { nums: [1, 2, 3, 4] } });
		expect(await evaluate(parseExpression("nums.reduce()"), ctx2)).toBe(10);
	});

	it(".containsAll()", async () => {
		expect(await evaluate(parseExpression('items.containsAll("a", "b")'), ctx)).toBe(true);
		expect(await evaluate(parseExpression('items.containsAll("a", "z")'), ctx)).toBe(false);
	});

	it(".containsAny()", async () => {
		expect(await evaluate(parseExpression('items.containsAny("z", "a")'), ctx)).toBe(true);
		expect(await evaluate(parseExpression('items.containsAny("x", "z")'), ctx)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Date methods
// ---------------------------------------------------------------------------

describe("date methods", () => {
	it(".format()", async () => {
		const ctx = makeContext();
		const result = await evaluate(parseExpression('date("2024-01-15").format("YYYY-MM-DD")'), ctx);
		expect(result).toBe("2024-01-15");
	});

	it(".format() with different format", async () => {
		const ctx = makeContext();
		const result = await evaluate(parseExpression('date("2024-01-15").format("DD/MM/YYYY")'), ctx);
		expect(result).toBe("15/01/2024");
	});

	it(".year", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('date("2024-01-15").year'), ctx)).toBe(2024);
	});

	it(".month", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('date("2024-01-15").month'), ctx)).toBe(1);
	});

	it(".day", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('date("2024-01-15").day'), ctx)).toBe(15);
	});

	it(".date()", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('date("2024-01-15").date()'), ctx)).toBe("2024-01-15");
	});

	it(".time()", async () => {
		const ctx = makeContext();
		const result = await evaluate(parseExpression('date("2024-01-15T14:30:00").time()'), ctx);
		expect(result).toBe("14:30:00");
	});

	it(".isEmpty()", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('date("2024-01-15").isEmpty()'), ctx)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Link methods
// ---------------------------------------------------------------------------

describe("link methods", () => {
	it(".toString()", async () => {
		const ctx = makeContext();
		const result = await evaluate(parseExpression('link("My Note").toString()'), ctx);
		expect(result).toBe("[[My Note]]");
	});

	it("link with display .toString()", async () => {
		const ctx = makeContext();
		const result = await evaluate(parseExpression('link("My Note", "click").toString()'), ctx);
		expect(result).toBe("[[My Note|click]]");
	});

	it(".isTruthy()", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression('link("Note").isTruthy()'), ctx)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// File methods
// ---------------------------------------------------------------------------

describe("file methods — via file() function", () => {
	it("file() resolves to ExprFile with properties", async () => {
		const targetFile = makeMockFile({ name: "target.md", basename: "target", path: "notes/target.md" });
		const ctx = makeContext();
		(ctx.app.metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockReturnValue(targetFile);
		(ctx.app.metadataCache.getFileCache as ReturnType<typeof vi.fn>).mockReturnValue({
			frontmatter: { title: "Target Title" },
			tags: [{ tag: "#test" }],
			links: [{ link: "Other" }],
		});

		const result = await evaluate(parseExpression('file("target")'), ctx) as ExprFile;
		expect(result.__type).toBe("file");
		expect(result.name).toBe("target.md");
		expect(result.basename).toBe("target");
		expect(result.tags).toContain("#test");
		expect(result.links).toContain("Other");
		expect(result.properties.title).toBe("Target Title");
	});

	it("file().name", async () => {
		const targetFile = makeMockFile({ name: "note.md", basename: "note", path: "note.md" });
		const ctx = makeContext();
		(ctx.app.metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockReturnValue(targetFile);
		(ctx.app.metadataCache.getFileCache as ReturnType<typeof vi.fn>).mockReturnValue({ frontmatter: {} });

		expect(await evaluate(parseExpression('file("note").name'), ctx)).toBe("note.md");
	});

	it("file().hasTag()", async () => {
		const targetFile = makeMockFile();
		const ctx = makeContext();
		(ctx.app.metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockReturnValue(targetFile);
		(ctx.app.metadataCache.getFileCache as ReturnType<typeof vi.fn>).mockReturnValue({
			frontmatter: {},
			tags: [{ tag: "#important" }],
		});

		const result = await evaluate(parseExpression('file("test").hasTag("important")'), ctx);
		expect(result).toBe(true);
	});

	it("file().hasProperty()", async () => {
		const targetFile = makeMockFile();
		const ctx = makeContext();
		(ctx.app.metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockReturnValue(targetFile);
		(ctx.app.metadataCache.getFileCache as ReturnType<typeof vi.fn>).mockReturnValue({
			frontmatter: { rating: 9 },
		});

		expect(await evaluate(parseExpression('file("test").hasProperty("rating")'), ctx)).toBe(true);
		expect(await evaluate(parseExpression('file("test").hasProperty("missing")'), ctx)).toBe(false);
	});

	it("file().content()", async () => {
		const targetFile = makeMockFile();
		const ctx = makeContext();
		(ctx.app.metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockReturnValue(targetFile);
		(ctx.app.metadataCache.getFileCache as ReturnType<typeof vi.fn>).mockReturnValue({ frontmatter: {} });
		(ctx.app.vault.cachedRead as ReturnType<typeof vi.fn>).mockResolvedValue("File body text");

		expect(await evaluate(parseExpression('file("test").content()'), ctx)).toBe("File body text");
	});

	it("file().asLink()", async () => {
		const targetFile = makeMockFile({ basename: "myfile" });
		const ctx = makeContext();
		(ctx.app.metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockReturnValue(targetFile);
		(ctx.app.metadataCache.getFileCache as ReturnType<typeof vi.fn>).mockReturnValue({ frontmatter: {} });

		const result = await evaluate(parseExpression('file("myfile").asLink()'), ctx) as ExprLink;
		expect(result.__type).toBe("link");
		expect(result.target).toBe("myfile");
	});

	it("file() returns null for non-existent file", async () => {
		const ctx = makeContext();
		(ctx.app.metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockReturnValue(null);

		expect(await evaluate(parseExpression('file("nonexistent")'), ctx)).toBe(null);
	});
});

// ---------------------------------------------------------------------------
// link().asFile() chain
// ---------------------------------------------------------------------------

describe("link().asFile() chain", () => {
	it("link().asFile() resolves to ExprFile", async () => {
		const targetFile = makeMockFile({ name: "linked.md", basename: "linked" });
		const ctx = makeContext();
		(ctx.app.metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockReturnValue(targetFile);
		(ctx.app.metadataCache.getFileCache as ReturnType<typeof vi.fn>).mockReturnValue({
			frontmatter: { genre: "sci-fi" },
		});

		const result = await evaluate(parseExpression('link("linked").asFile()'), ctx) as ExprFile;
		expect(result.__type).toBe("file");
		expect(result.name).toBe("linked.md");
	});

	it("link().asFile().content() reads body", async () => {
		const targetFile = makeMockFile();
		const ctx = makeContext();
		(ctx.app.metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockReturnValue(targetFile);
		(ctx.app.metadataCache.getFileCache as ReturnType<typeof vi.fn>).mockReturnValue({ frontmatter: {} });
		(ctx.app.vault.cachedRead as ReturnType<typeof vi.fn>).mockResolvedValue("Body of linked file");

		const result = await evaluate(parseExpression('link("test").asFile().content()'), ctx);
		expect(result).toBe("Body of linked file");
	});

	it("link().asFile() returns null when file doesn't exist", async () => {
		const ctx = makeContext();
		(ctx.app.metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockReturnValue(null);

		expect(await evaluate(parseExpression('link("missing").asFile()'), ctx)).toBe(null);
	});
});

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

describe("isExpressionMode", () => {
	it("detects expression mode for function calls", () => {
		expect(isExpressionMode("link(cast[0]).asFile()")).toBe(true);
	});

	it("detects legacy mode for simple property | filter", () => {
		expect(isExpressionMode("title | upper")).toBe(false);
	});

	it("detects expression mode when ( appears before |", () => {
		expect(isExpressionMode("if(x > 1, y) | trim")).toBe(true);
	});

	it("detects legacy mode when | appears before (", () => {
		expect(isExpressionMode("title | replace('a', 'b')")).toBe(false);
	});

	it("detects expression mode for operators", () => {
		expect(isExpressionMode("rating > 8")).toBe(true);
	});

	it("detects legacy mode for simple property", () => {
		expect(isExpressionMode("title")).toBe(false);
	});

	it("handles quoted strings correctly", () => {
		// Pipe inside quotes should not count
		expect(isExpressionMode('replace("a|b", "c")')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// splitExpressionAndPipes
// ---------------------------------------------------------------------------

describe("splitExpressionAndPipes", () => {
	it("splits expression and pipe filters", () => {
		const result = splitExpressionAndPipes('link("test").asFile().name | upper | trim');
		expect(result.expression).toBe('link("test").asFile().name');
		expect(result.pipeFilters).toBe("upper | trim");
	});

	it("returns null pipeFilters when no pipe", () => {
		const result = splitExpressionAndPipes('link("test").asFile().name');
		expect(result.expression).toBe('link("test").asFile().name');
		expect(result.pipeFilters).toBeNull();
	});

	it("does not split on || (logical or)", () => {
		const result = splitExpressionAndPipes("a || b");
		expect(result.expression).toBe("a || b");
		expect(result.pipeFilters).toBeNull();
	});

	it("does not split on pipes inside parens", () => {
		const result = splitExpressionAndPipes('replace("a|b", "c") | upper');
		expect(result.expression).toBe('replace("a|b", "c")');
		expect(result.pipeFilters).toBe("upper");
	});

	it("handles simple legacy expressions", () => {
		const result = splitExpressionAndPipes("title | upper");
		expect(result.expression).toBe("title");
		expect(result.pipeFilters).toBe("upper");
	});
});

// ---------------------------------------------------------------------------
// evaluateExpression — integration
// ---------------------------------------------------------------------------

describe("evaluateExpression", () => {
	it("evaluates expression with trailing pipe filter", async () => {
		const ctx = makeContext({ frontmatter: { title: "hello world" } });
		const result = await evaluateExpression("title.upper()", ctx);
		expect(result).toBe("HELLO WORLD");
	});

	it("returns null for errors", async () => {
		const ctx = makeContext();
		const result = await evaluateExpression(")))invalid(((", ctx);
		expect(result).toBe(null);
	});
});

// ---------------------------------------------------------------------------
// Clipper-style logic blocks
// ---------------------------------------------------------------------------

describe("processLogicBlocks", () => {
	describe("{% set %}", () => {
		it("sets a simple string variable", async () => {
			const ctx = makeContext();
			const result = await processLogicBlocks('{% set greeting = "hello" %}{{greeting}}', ctx);
			// The {% set %} is removed; variable is stored in ctx
			expect(result).not.toContain("{%");
			expect(ctx.variables.greeting).toBe("hello");
		});

		it("sets a numeric variable", async () => {
			const ctx = makeContext();
			await processLogicBlocks("{% set count = 42 %}", ctx);
			expect(ctx.variables.count).toBe(42);
		});

		it("sets variable from expression", async () => {
			const ctx = makeContext({ frontmatter: { rating: 9 } });
			await processLogicBlocks("{% set isGood = rating > 8 %}", ctx);
			expect(ctx.variables.isGood).toBe(true);
		});
	});

	describe("{% if %}", () => {
		it("renders body when condition is true", async () => {
			const ctx = makeContext({ frontmatter: { rating: 9 } });
			const result = await processLogicBlocks("{% if rating > 5 %}GOOD{% endif %}", ctx);
			expect(result).toBe("GOOD");
		});

		it("renders nothing when condition is false", async () => {
			const ctx = makeContext({ frontmatter: { rating: 3 } });
			const result = await processLogicBlocks("{% if rating > 5 %}GOOD{% endif %}", ctx);
			expect(result).toBe("");
		});

		it("handles {% else %}", async () => {
			const ctx = makeContext({ frontmatter: { rating: 3 } });
			const result = await processLogicBlocks("{% if rating > 5 %}GOOD{% else %}BAD{% endif %}", ctx);
			expect(result).toBe("BAD");
		});

		it("handles {% elif %}", async () => {
			const ctx = makeContext({ frontmatter: { rating: 6 } });
			const result = await processLogicBlocks(
				'{% if rating > 8 %}GREAT{% elif rating > 5 %}OK{% else %}BAD{% endif %}',
				ctx
			);
			expect(result).toBe("OK");
		});

		it("handles true condition with string check", async () => {
			const ctx = makeContext({ frontmatter: { status: "active" } });
			const result = await processLogicBlocks(
				'{% if status == "active" %}Active!{% endif %}',
				ctx
			);
			expect(result).toBe("Active!");
		});
	});

	describe("{% for %}", () => {
		it("iterates over a list from frontmatter and resolves loop variables", async () => {
			const ctx = makeContext({ frontmatter: { tags: ["a", "b", "c"] } });
			const result = await processLogicBlocks("{% for tag in tags %}[{{tag}}]{% endfor %}", ctx);
			// Loop variables are now resolved inside the for body
			expect(result).toBe("[a][b][c]");
		});

		it("provides loop variable", async () => {
			const ctx = makeContext({ frontmatter: { items: ["x", "y"] } });
			const result = await processLogicBlocks("{% for item in items %}{{loop.index}}{% endfor %}", ctx);
			// loop.index is 1-based, resolved inside the loop body
			expect(result).toBe("12");
		});

		it("renders empty string for non-array", async () => {
			const ctx = makeContext({ frontmatter: { val: "not-a-list" } });
			const result = await processLogicBlocks("{% for item in val %}{{item}}{% endfor %}", ctx);
			expect(result).toBe("");
		});

		it("renders empty string for missing variable", async () => {
			const ctx = makeContext();
			const result = await processLogicBlocks("{% for item in missing %}{{item}}{% endfor %}", ctx);
			expect(result).toBe("");
		});

		it("resolves loop variable with filter chains", async () => {
			const ctx = makeContext({ frontmatter: { names: ["alice", "bob"] } });
			const result = await processLogicBlocks(
				"{% for name in names %}{{name | upper}}, {% endfor %}",
				ctx
			);
			expect(result).toBe("ALICE, BOB, ");
		});

		it("resolves loop variable with replace filter (wiki-link stripping)", async () => {
			const ctx = makeContext({
				frontmatter: { assets: ["[[photo1.jpg]]", "[[photo2.jpg]]"] }
			});
			const result = await processLogicBlocks(
				'{% for img in assets %}{{img | replace:"[[","" | replace:"]]",""}},{% endfor %}',
				ctx
			);
			expect(result).toBe("photo1.jpg,photo2.jpg,");
		});

		it("resolves loop.index0, loop.first, loop.last, loop.length", async () => {
			const ctx = makeContext({ frontmatter: { items: ["a", "b", "c"] } });
			const result = await processLogicBlocks(
				"{% for item in items %}{{loop.index0}}:{{loop.first}}:{{loop.last}} {% endfor %}",
				ctx
			);
			expect(result).toBe("0:true:false 1:false:false 2:false:true ");
		});

		it("does not resolve frontmatter placeholders (leaves for renderer)", async () => {
			const ctx = makeContext({ frontmatter: { items: ["x"], title: "My Title" } });
			const result = await processLogicBlocks(
				"{% for item in items %}{{item}}:{{title}}{% endfor %}",
				ctx
			);
			// {{item}} is a loop variable so it gets resolved
			// {{title}} is NOT a loop variable — it's frontmatter, so it stays for the renderer
			expect(result).toBe("x:{{title}}");
		});

		it("resolves loop variable used in HTML attributes", async () => {
			const ctx = makeContext({
				frontmatter: { images: ["cat.jpg", "dog.jpg"] }
			});
			const result = await processLogicBlocks(
				'{% for src in images %}<img src="{{src}}" alt="">{% endfor %}',
				ctx
			);
			expect(result).toBe('<img src="cat.jpg" alt=""><img src="dog.jpg" alt="">');
		});

		it("resolves loop variable used as a function argument", async () => {
			const ctx = makeContext({
				frontmatter: { images: ["cat 1.jpg", "dog.jpg"] }
			});
			const result = await processLogicBlocks(
				"{% for src in images %}{{image(src)}}{% endfor %}",
				ctx
			);
			expect(result).toBe("![](<cat 1.jpg>)![](dog.jpg)");
		});
	});

	describe("{% set %} variable resolution", () => {
		it("resolves set variables in subsequent placeholders", async () => {
			const ctx = makeContext({ frontmatter: { name: "world" } });
			const result = await processLogicBlocks(
				'{% set greeting = "hello" %}{{greeting}}',
				ctx
			);
			expect(result).toBe("hello");
		});

		it("resolves set variable with filter chain", async () => {
			const ctx = makeContext();
			const result = await processLogicBlocks(
				'{% set word = "hello" %}{{word | upper}}',
				ctx
			);
			expect(result).toBe("HELLO");
		});
	});

	describe("nested logic", () => {
		it("if inside for", async () => {
			const ctx = makeContext({ frontmatter: { nums: [1, 5, 3, 8, 2] } });
			const result = await processLogicBlocks(
				"{% for n in nums %}{% if n > 4 %}{{n}} {% endif %}{% endfor %}",
				ctx
			);
			// Only 5 and 8 pass the filter, and {{n}} is resolved to the actual values
			expect(result.trim()).toBe("5 8");
		});

		it("for inside for with different variable names", async () => {
			const ctx = makeContext({ frontmatter: { rows: ["a", "b"], cols: ["1", "2"] } });
			const result = await processLogicBlocks(
				"{% for row in rows %}{% for col in cols %}{{row}}{{col}} {% endfor %}{% endfor %}",
				ctx
			);
			expect(result).toBe("a1 a2 b1 b2 ");
		});

		it("for inside for can iterate over values from the outer loop variable", async () => {
			const ctx = makeContext({
				frontmatter: {
					rows: [
						{ name: "Belinda Says", categories: ["Songs"] },
						{ name: "In Undertow", categories: ["Music Videos", "Songs"] },
					],
				},
			});
			const result = await processLogicBlocks(
				"{% for row in rows %}{{row.name}}:{% for category in row.categories %}[{{category}}]{% endfor %};{% endfor %}",
				ctx
			);
			expect(result).toBe("Belinda Says:[Songs];In Undertow:[Music Videos][Songs];");
		});
	});
});

// ---------------------------------------------------------------------------
// Complex expression chains
// ---------------------------------------------------------------------------

describe("complex expressions", () => {
	it("chained method calls", async () => {
		const ctx = makeContext({ frontmatter: { title: "Hello World" } });
		expect(await evaluate(parseExpression('title.upper().slice(0, 5)'), ctx)).toBe("HELLO");
	});

	it("nested function calls", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression("min(max(1, 2), 3)"), ctx)).toBe(2);
	});

	it("arithmetic with frontmatter", async () => {
		const ctx = makeContext({ frontmatter: { price: 100, tax: 0.1 } });
		expect(await evaluate(parseExpression("price * (1 + tax)"), ctx)).toBeCloseTo(110);
	});

	it("conditional with method calls", async () => {
		const ctx = makeContext({ frontmatter: { status: "ACTIVE" } });
		expect(await evaluate(parseExpression('if(status.lower() == "active", "Yes", "No")'), ctx)).toBe("Yes");
	});

	it("list method chaining", async () => {
		const ctx = makeContext({ frontmatter: { tags: ["b", "a", "c", "a"] } });
		const result = await evaluate(parseExpression('tags.unique().sort().join(" ")'), ctx);
		expect(result).toBe("a b c");
	});

	it("property access on null returns null", async () => {
		const ctx = makeContext();
		expect(await evaluate(parseExpression("missing.property"), ctx)).toBe(null);
	});

	it("method call on null falls through to string conversion", async () => {
		const ctx = makeContext();
		// missing → null, null.upper() → String(null).toUpperCase() = ""
		expect(await evaluate(parseExpression("missing.upper()"), ctx)).toBe("");
	});
});
