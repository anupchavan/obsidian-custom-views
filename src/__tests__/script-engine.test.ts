import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { executeCustomViewJavaScript, type CustomViewScriptContext } from "../script-engine";

function context(): CustomViewScriptContext {
	return { app: new App(), file: new TFile(), container: document.createElement("div"),
		frontmatter: { title: "Example" }, bodyContent: "Body", viewConfig: undefined,
		activeDocument: document, activeWindow: window };
}

describe("custom view JavaScript", () => {
	it("preserves this, tp, DOM access, and awaited completion", async () => {
		const ctx = context();
		await executeCustomViewJavaScript(`
			await Promise.resolve();
			const child = tp.activeDocument.createElement('span');
			child.textContent = tp.frontmatter.title + tp.bodyContent;
			this.append(child);
			this.dataset.same = String(this === tp.container);
		`, ctx);
		expect(ctx.container.textContent).toBe("ExampleBody");
		expect(ctx.container.dataset.same).toBe("true");
	});
	it("isolates local declarations across repeated calls and ignores script return values", async () => {
		const ctx = context();
		const code = "const local = 1; this.dataset.n = String(Number(this.dataset.n || 0) + local); return 42;";
		expect(await executeCustomViewJavaScript(code, ctx)).toBeUndefined();
		await executeCustomViewJavaScript(code, ctx);
		expect(ctx.container.dataset.n).toBe("2");
	});
	it("accepts template delimiters and trailing line comments as ordinary JavaScript", async () => {
		const ctx = context();
		await executeCustomViewJavaScript("this.textContent = '\uE000/custom-views-js\uE001 <% {{ }}'; // trailing", ctx);
		expect(ctx.container.textContent).toBe("\uE000/custom-views-js\uE001 <% {{ }}");
	});
	it("keeps the legacy tR binding available", async () => {
		const ctx = context();
		await executeCustomViewJavaScript("tR += 'text'; this.textContent = tR;", ctx);
		expect(ctx.container.textContent).toBe("text");
	});
	it.each(["throw new Error('failure')", "await Promise.reject(new Error('failure'))"])("propagates script errors: %s", async code => {
		await expect(executeCustomViewJavaScript(code, context())).rejects.toThrow("failure");
	});
	it("rejects syntax errors without executing the script", async () => {
		const ctx = context();
		await expect(executeCustomViewJavaScript("this.textContent = 'bad'; const =", ctx)).rejects.toThrow(SyntaxError);
		expect(ctx.container.textContent).toBe("");
	});
});
