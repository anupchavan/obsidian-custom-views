import type { App, TFile } from "obsidian";
import type { Renderer } from "@silentvoid13/rusty_engine";
import type { ViewConfig } from "./types";

const DEFAULT_OPEN_TAG = "\uE000custom-views-js\uE001";
const DEFAULT_CLOSE_TAG = "\uE000/custom-views-js\uE001";

const rendererPromises = new Map<string, Promise<Renderer>>();

export interface CustomViewScriptContext {
	app: App;
	file: TFile;
	container: HTMLElement;
	frontmatter: Record<string, unknown> | undefined;
	bodyContent: string;
	viewConfig: ViewConfig | undefined;
	activeDocument: Document;
	activeWindow: Window;
}

interface ScriptDelimiters {
	openTag: string;
	closeTag: string;
}

export function getScriptExecutionDelimiters(code: string): ScriptDelimiters {
	let index = 0;
	let delimiters = {
		openTag: DEFAULT_OPEN_TAG,
		closeTag: DEFAULT_CLOSE_TAG,
	};

	while (code.includes(delimiters.openTag) || code.includes(delimiters.closeTag)) {
		index += 1;
		delimiters = {
			openTag: `\uE000custom-views-js-${index}\uE001`,
			closeTag: `\uE000/custom-views-js-${index}\uE001`,
		};
	}

	return delimiters;
}

export function buildScriptExecutionTemplate(code: string, delimiters = getScriptExecutionDelimiters(code)): string {
	return `${delimiters.openTag}*await (async function () {\n${code}\n}).call(tp.container);\n${delimiters.closeTag}`;
}

export async function executeCustomViewJavaScript(code: string, context: CustomViewScriptContext): Promise<void> {
	const delimiters = getScriptExecutionDelimiters(code);
	const renderer = await getScriptRenderer(delimiters);
	await renderer.render_content(buildScriptExecutionTemplate(code, delimiters), context);
}

export async function warmCustomViewScriptEngine(): Promise<void> {
	await getScriptRenderer({
		openTag: DEFAULT_OPEN_TAG,
		closeTag: DEFAULT_CLOSE_TAG,
	});
}

async function getScriptRenderer(delimiters: ScriptDelimiters): Promise<Renderer> {
	const key = `${delimiters.openTag}\n${delimiters.closeTag}`;
	let rendererPromise = rendererPromises.get(key);

	if (!rendererPromise) {
		rendererPromise = createScriptRenderer(delimiters).catch((error) => {
			rendererPromises.delete(key);
			throw error;
		});
		rendererPromises.set(key, rendererPromise);
	}

	return rendererPromise;
}

async function createScriptRenderer(delimiters: ScriptDelimiters): Promise<Renderer> {
	const [engine, wasm] = await Promise.all([
		import("@silentvoid13/rusty_engine/rusty_engine.js"),
		import("@silentvoid13/rusty_engine/rusty_engine_bg.wasm"),
	]);

	await engine.default(wasm.default);

	return new engine.Renderer(
		new engine.ParserConfig(
			delimiters.openTag,
			delimiters.closeTag,
			"\0",
			"*",
			"-",
			"_",
			"tR",
		),
	);
}
