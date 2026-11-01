import { describe, expect, it } from "vitest";
import { compileTemplate, renderTemplateWithKnap, templateParseError, type TemplateHooks } from "../template-engine";
import { offsetBeforeStripping } from "../bases/template-syntax";

/** Evaluates a slot as a variable name, or as a JSON literal. */
const hooks: TemplateHooks = {
	evaluate(slot, variables) {
		const path = slot.source.split(".");
		if (path[0] in variables) {
			return Promise.resolve(path.slice(1).reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], variables[path[0]]));
		}
		return Promise.resolve(JSON.parse(slot.source) as unknown);
	},
	isTruthy: value => Array.isArray(value) ? value.length > 0 : !!value,
	output: value => typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "",
};

async function render(template: string, variables: Record<string, unknown> = {}) {
	const result = await renderTemplateWithKnap(template, hooks, variables);
	expect(result.errors).toEqual([]);
	return result.output;
}

describe("compileTemplate", () => {
	it("hands Knap a slot number in place of each expression", () => {
		const { slots, errors } = compileTemplate('{{ file.hasTag("x") }}{% if (a / 60).floor() != 0 %}y{% endif %}{% for t in list(a).filter(value > 1) %}{% endfor %}{% set z = a ?? 1 %}');
		expect(errors).toEqual([]);
		expect(slots.map(slot => [slot.kind, slot.source])).toEqual([
			["output", 'file.hasTag("x")'],
			["if", "(a / 60).floor() != 0"],
			["for", "list(a).filter(value > 1)"],
			["set", "a ?? 1"],
		]);
	});

	it("records where each slot starts in the template", () => {
		const template = "ab {{ x }} {% if y %}{% endif %}";
		expect(compileTemplate(template).slots.map(slot => slot.offset)).toEqual([3, 11]);
	});

	it("places Knap's errors in the template as written", () => {
		const template = '{{ a.reallyLongMethodName("with arguments") }}\n{% if b %}\nno end';
		const [error] = compileTemplate(template).errors;
		expect(error.message).toMatch(/endif/);
		// Knap reports a missing endif where the template ends.
		expect(templateParseError("Template", template, error)).toMatchObject({ line: 3, column: 7 });
	});

	it("reports a tag Knap doesn't know", () => {
		const template = 'x {{ long.expression("here") }} {% frobnicate %}';
		const [error] = compileTemplate(template).errors;
		expect(error.message).toMatch(/frobnicate/);
		expect(template.slice(error.offset)).toBe("frobnicate %}");
	});
});

describe("renderTemplateWithKnap", () => {
	it("picks the first true branch of if, elseif and else", async () => {
		const template = '{% if a %}A{% elseif b %}B{% else %}C{% endif %}';
		expect(await render(template, { a: true, b: true })).toBe("A");
		expect(await render(template, { a: false, b: true })).toBe("B");
		expect(await render(template, { a: false, b: false })).toBe("C");
	});

	it("accepts elif for elseif", async () => {
		expect(await render('{% if a %}A{% elif b %}B{% endif %}', { a: false, b: true })).toBe("B");
	});

	it("joins loop iterations without adding newlines", async () => {
		expect(await render("{% for t in tags %}[{{ t }}]{% endfor %}", { tags: ["a", "b"] })).toBe("[a][b]");
	});

	it("gives each iteration a loop object", async () => {
		expect(await render("{% for t in tags %}{{ loop.index }}{{ loop.last }} {% endfor %}", { tags: ["a", "b"] })).toBe("1false 2true ");
	});

	it("lets an inner loop read the outer loop's variable", async () => {
		const albums = [{ name: "A", songs: ["1", "2"] }, { name: "B", songs: ["3"] }];
		expect(await render("{% for a in albums %}{{ a.name }}:{% for s in a.songs %}{{ s }}{% endfor %};{% endfor %}", { albums })).toBe("A:12;B:3;");
	});

	it("keeps a set inside a loop to that iteration", async () => {
		expect(await render('{% set x = "out" %}{% for t in tags %}{% set x = t %}{{ x }}{% endfor %}{{ x }}', { tags: ["a"] })).toBe("aout");
	});

	it("keeps a set inside an if for the rest of the template", async () => {
		expect(await render('{% if true %}{% set x = "in" %}{% endif %}{{ x }}')).toBe("in");
	});

	it("skips a loop over something that isn't a list", async () => {
		expect(await render("{% for t in missing %}x{% endfor %}", { missing: null })).toBe("");
	});

	it("drops comments and keeps the surrounding text", async () => {
		expect(await render("a {# note {{ x }} #}b")).toBe("a b");
	});

	it("keeps whitespace between tags, except before a closing tag, as Knap parses it", async () => {
		expect(await render("<h1>\n  {% if true %}\n  A\n  {% endif %}\n</h1>")).toBe("<h1>\n  \n  A\n</h1>");
	});

	it("renders nothing when the template doesn't parse", async () => {
		const result = await renderTemplateWithKnap("{% if a %}", hooks);
		expect(result.output).toBe("");
		expect(result.errors).toHaveLength(1);
	});
});

describe("offsetBeforeStripping", () => {
	it("moves an offset past the base blocks stripped before it", () => {
		const block = '{% base %}\nfilters: x\n{% endbase %}\n';
		const template = `${block}{% if a %}`;
		// Stripping keeps the newline after {% endbase %}, so the if starts at 1.
		expect(offsetBeforeStripping(template, 1)).toBe(block.length);
	});
});
