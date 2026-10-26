import { describe, expect, it } from "vitest";
import { parser as cssParser } from "@lezer/css";
import { parser as jsParser } from "@lezer/javascript";
import { analyzeCss, analyzeJavaScript, analyzeTemplate, closest, maskTemplateSyntax, scriptErrorPosition, type TemplateDiagnostic } from "../template-diagnostics";
import { executeCustomViewJavaScript, type CustomViewScriptContext } from "../script-engine";
import { evaluateExpression, parseExpression, type ExprContext } from "../expression";

const properties = ["published", "cover", "photo", "rating", "cast", "title", "release-date"];
const check = (source: string) => analyzeTemplate(source, { properties });
const marked = (source: string, diagnostic: TemplateDiagnostic) => source.slice(diagnostic.from, diagnostic.to);

describe("template diagnostics", () => {
	it("accepts the template syntax the renderer supports", () => {
		const valid = [
			"<h1>{{file.basename}}</h1>\n{{file.content}}",
			"{{ title | upper | trim }} {{ cover | image:\"Poster\" }} {{ content }}",
			"{{ link(cast[0]).asFile().name | upper }}",
			"{{ if(rating > 3, \"good\", \"bad\") }} {{ rating ?? 0 }} {{ not cover and rating >= 3 }}",
			"{% for actor in cast %}{{ actor }} {{ loop.index }}{% endfor %}",
			"{% set score = rating * 2 %}{{ score }}",
			"{% if rating > 3 %}a{% elif rating > 1 %}b{% else %}c{% endif %}",
			"{{ release-date }} {{ \"release-date\" }} {{ title.upper() }} {{ cast.length }}",
			"{% base Books %}\nfilters: {{ anything goes here }}\n{% endbase %}",
		];
		for (const source of valid) expect(check(source), source).toEqual([]);
	});

	it("names an unknown filter and suggests the closest one", () => {
		const source = "{{ cover | imag }}";
		const [diagnostic] = check(source);
		expect(diagnostic).toMatchObject({ severity: "error", message: "Unknown filter `imag`" });
		expect(diagnostic.hint).toContain("Did you mean `image`?");
		expect(marked(source, diagnostic)).toBe("imag");
	});

	it("explains filter arguments written as a call", () => {
		const [diagnostic] = check('{{ published | date("YYYY") }}');
		expect(diagnostic.message).toBe("Filter arguments go after a colon, not in brackets");
		expect(diagnostic.hint).toBe('Write it like `date:"…"`.');
	});

	it("warns about property names with the wrong case", () => {
		const source = "<div>{{image(PHOTO)}}</div>";
		const [diagnostic] = check(source);
		expect(diagnostic).toMatchObject({ severity: "warning", message: "No note has a property named `PHOTO`" });
		expect(diagnostic.hint).toBe("Property names are case-sensitive. Did you mean `photo`?");
		expect(marked(source, diagnostic)).toBe("PHOTO");
	});

	it("suggests near-miss property names and skips the check without vault properties", () => {
		expect(check("{{ covr }}")[0].hint).toBe("Did you mean `cover`?");
		expect(check("{{ nothingLikeIt }}")[0].hint).toBe("It renders empty until a note has this property.");
		expect(analyzeTemplate("{{ covr }}")).toEqual([]);
	});

	it("points at the bracket that is never closed", () => {
		const source = "{{ image(cover }}";
		const [diagnostic] = check(source);
		expect(diagnostic.message).toBe("This `(` is never closed");
		expect(diagnostic.from).toBe(source.indexOf("("));
	});

	it("explains incomplete and stray parts of expressions", () => {
		expect(check("{{ rating > }}")[0]).toMatchObject({ message: "The expression ends too early", hint: "Add a value after `>`." });
		expect(check("{{ rating = 5 }}")[0]).toMatchObject({ message: "Unexpected `=`", hint: "To compare values, use `==`." });
		expect(check("{{ link(cast[0]) cover }}")[0].message).toBe("Unexpected `cover` after the expression");
		expect(check('{{ "abc + title }}')[0].message).toBe("This text is never closed");
		expect(check("{{ title | }}")[0].message).toBe("There's no filter after this `|`");
	});

	it("checks functions and methods against the engine", () => {
		expect(check("{{ imgae(cover) }}")[0]).toMatchObject({ message: "Unknown function `imgae()`", hint: "Did you mean `image()`?" });
		expect(check("{{ upper(title) }}")[0].hint).toBe("`upper` is a filter. Apply it with a pipe: `value | upper`.");
		expect(check("{{ title.uper() }}")[0]).toMatchObject({ message: "Unknown method `.uper()`", hint: "Did you mean `.upper()`?" });
	});

	it("checks block structure", () => {
		expect(check("{% if rating > 3 %}x")[0].message).toBe("This `{% if %}` is never closed");
		expect(check("{% endfor %}")[0].message).toBe("`{% endfor %}` has no opening `{% for %}`");
		expect(check("{% for a in cast %}{% if a %}{% endfor %}").map(d => d.message)).toEqual([
			"`{% endfor %}` closes `{% for %}` while `{% if %}` from line 1 is still open",
		]);
		expect(check("{% if cover %}{% else %}{% else %}{% endif %}")[0].message).toBe("This `{% if %}` already has an `{% else %}`");
		expect(check("{% else %}")[0].message).toBe("`{% else %}` is outside an `{% if %}` block");
		expect(check("{% fi cover %}")[0]).toMatchObject({ message: "Unknown tag `fi`", hint: "Did you mean `if`?" });
		expect(check("{% for cast %}{% endfor %}")[0].hint).toBe("Write it like `{% for actor in cast %}`.");
		expect(check("{% if %}{% endif %}")[0].message).toBe("`{% if %}` needs a condition");
	});

	it("reports unclosed delimiters", () => {
		expect(check("{{ cover")[0].message).toBe("This placeholder is never closed");
		expect(check("{% if cover")[0].message).toBe("This `{%` tag is never closed");
		expect(check("{{ }}")[0]).toMatchObject({ severity: "warning", message: "This placeholder is empty" });
	});

	it("sorts problems by position", () => {
		const positions = check("{{ covr }} {{ cover | imag }} {% endif %}").map(d => d.from);
		expect(positions).toEqual([...positions].sort((a, b) => a! - b!));
	});
});

describe("expression engine compatibility", () => {
	it("keeps the render-time parser forgiving", async () => {
		// Diagnostics are stricter than rendering; rendering must not change.
		expect(() => parseExpression("a b")).not.toThrow();
		const ctx = { variables: {}, frontmatter: { a: 1 } } as unknown as ExprContext;
		expect(await evaluateExpression("a b", ctx)).toBe(1);
	});
});

describe("CSS diagnostics", () => {
	it("finds unclosed and stray braces", () => {
		expect(analyzeCss(".a { color: red", cssParser)[0]).toMatchObject({ from: 3, message: "This `{` is never closed" });
		expect(analyzeCss(".a {} }", cssParser)[0]).toMatchObject({ from: 6, message: "Unexpected `}`" });
	});

	it("names a declaration missing its colon", () => {
		const source = ".a {\n  color red;\n}";
		const [diagnostic] = analyzeCss(source, cssParser);
		expect(diagnostic.message).toBe("Expected `:` after `color`");
		expect(marked(source, diagnostic)).toBe("color");
		expect(analyzeCss(".poster { width: 160px; border-radius 12px; }", cssParser)[0].message).toBe("Expected `:` after `border-radius`");
	});

	it("ignores template placeholders inside CSS", () => {
		expect(analyzeCss(".hero { background: url({{cover}}); }\n{% if rating %}.a { color: red; }{% endif %}", cssParser)).toEqual([]);
		expect(maskTemplateSyntax("a {{b}}\n{% c %}")).toBe("a _____\n       ");
	});
});

describe("JavaScript diagnostics", () => {
	it("accepts top-level await, return and placeholders", () => {
		expect(analyzeJavaScript("const rating = {{rating}};\nawait Promise.resolve();\nreturn rating;", jsParser)).toEqual([]);
	});

	it("reports the engine's message at the parser's position", () => {
		const source = "const a = 1;\nconst b = 2 3;";
		const [diagnostic] = analyzeJavaScript(source, jsParser);
		expect(diagnostic.message).toBe("Unexpected number");
		expect(marked(source, diagnostic)).toBe("3");
	});

	it("blames the author's unclosed bracket, not the generated wrapper", () => {
		const source = "function render() {\n  return 1;\n";
		const [diagnostic] = analyzeJavaScript(source, jsParser);
		expect(diagnostic).toMatchObject({ from: source.indexOf("{"), message: "This `{` is never closed" });
	});

	it("maps a runtime stack back to the author's line", async () => {
		const context = { container: document.createElement("div"), activeWindow: window } as unknown as CustomViewScriptContext;
		const error = await executeCustomViewJavaScript("const x = 1;\n\nnull.foo;", context).catch((thrown: unknown) => thrown);
		expect(scriptErrorPosition(error)).toEqual({ line: 3, column: 6 });
	});
});

describe("closest", () => {
	it("prefers same-letter matches and counts adjacent swaps as one edit", () => {
		expect(closest("PHOTO", ["photos", "photo"])).toBe("photo");
		expect(closest("imgae", ["image", "upper"])).toBe("image");
		expect(closest("xyz", ["image"])).toBeUndefined();
	});
});
