import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import {
	buildScriptExecutionTemplate,
	executeCustomViewJavaScript,
	getScriptExecutionDelimiters,
	warmCustomViewScriptEngine,
} from "../script-engine";
import type { CustomViewScriptContext } from "../script-engine";

describe("script engine template wrapper", () => {
	it("wraps JavaScript in an execution command bound to the rendered container", () => {
		const template = buildScriptExecutionTemplate("this.dataset.ready = 'true';");

		expect(template).toContain("*await (async function () {");
		expect(template).toContain("this.dataset.ready = 'true';");
		expect(template).toContain("}).call(tp.container);");
	});

	it("chooses alternate delimiters when user code contains the defaults", () => {
		const code = "const marker = '\uE000/custom-views-js\uE001';";
		const delimiters = getScriptExecutionDelimiters(code);

		expect(delimiters.openTag).toBe("\uE000custom-views-js-1\uE001");
		expect(delimiters.closeTag).toBe("\uE000/custom-views-js-1\uE001");
	});

	it("executes JavaScript with the rendered container as this", async () => {
		const doc = new DOMParser().parseFromString("<div></div>", "text/html");
		const container = doc.body.firstElementChild as HTMLElement;
		const context: CustomViewScriptContext = {
			app: new App(),
			file: new TFile(),
			container,
			frontmatter: undefined,
			bodyContent: "",
			viewConfig: undefined,
			activeDocument: doc,
			activeWindow: doc.defaultView as Window,
		};

		await executeCustomViewJavaScript("this.dataset.ready = 'true';", context);

		expect(container.dataset.ready).toBe("true");
	});

	it("can pre-initialize the WASM renderer before executing scripts", async () => {
		const doc = new DOMParser().parseFromString("<div></div>", "text/html");
		const container = doc.body.firstElementChild as HTMLElement;
		const context: CustomViewScriptContext = {
			app: new App(),
			file: new TFile(),
			container,
			frontmatter: undefined,
			bodyContent: "",
			viewConfig: undefined,
			activeDocument: doc,
			activeWindow: doc.defaultView as Window,
		};

		await warmCustomViewScriptEngine();
		await executeCustomViewJavaScript("this.dataset.warmed = 'true';", context);

		expect(container.dataset.warmed).toBe("true");
	});
});
