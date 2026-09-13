import type { App, TFile } from "obsidian";
import type { ViewConfig } from "./types";

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

// User scripts intentionally execute as JavaScript, as they did through Rusty.
// They run only after the renderer checks the allowJavaScript setting.
type ScriptConstructor = new (contextName: string, body: string) => (context: CustomViewScriptContext) => Promise<unknown>;
const AsyncFunction = (Object.getPrototypeOf(async function () {}) as { constructor: ScriptConstructor }).constructor;

export async function executeCustomViewJavaScript(code: string, context: CustomViewScriptContext): Promise<void> {
	// Use the container's realm so an editor preview iframe owns its timers and globals.
	const realm = context.activeWindow as Window & { Function: FunctionConstructor };
	const Constructor = realm && realm !== window
		? (realm.Function("return (async function () {}).constructor") as () => ScriptConstructor)()
		: AsyncFunction;
	const execute = new Constructor("tp", `let tR = ''; await (async function () {\n${code}\n}).call(tp.container);`);
	await execute(context);
}
