import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { resolve } from "path";

const rustyEngineWasmId = "@silentvoid13/rusty_engine/rusty_engine_bg.wasm";
const virtualRustyEngineWasmId = "\0rusty-engine-wasm-bytes";

function rustyEngineWasmBytesPlugin() {
	return {
		name: "rusty-engine-wasm-bytes",
		enforce: "pre" as const,
		resolveId(id: string) {
			if (id === rustyEngineWasmId) return virtualRustyEngineWasmId;
			return null;
		},
		load(id: string) {
			if (id !== virtualRustyEngineWasmId) return null;

			const bytes = readFileSync(resolve(__dirname, "node_modules/@silentvoid13/rusty_engine/rusty_engine_bg.wasm"));
			const base64 = bytes.toString("base64");
			return `export default Uint8Array.from(atob("${base64}"), c => c.charCodeAt(0));`;
		},
	};
}

export default defineConfig({
	plugins: [rustyEngineWasmBytesPlugin()],
	test: {
		// Use jsdom so DOMParser and other browser APIs are available
		environment: "jsdom",
		globals: true,
		// Where to find test files
		include: ["src/__tests__/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: ["src/**/*.ts"],
			exclude: ["src/main.ts", "src/settings.ts", "src/__tests__/**"],
		},
		// Force Vitest to process (and deduplicate) all @codemirror/@lezer deps
		server: {
			deps: {
				inline: [
					/@codemirror\//,
					/@lezer\//,
				],
			},
		},
	},
	resolve: {
		alias: {
			// Redirect all `import ... from 'obsidian'` to our mock
			obsidian: resolve(__dirname, "__mocks__/obsidian.ts"),
			// Force all CodeMirror imports to the single top-level ESM entry
			// to prevent "multiple instances of @codemirror/state" errors
			"@codemirror/state": resolve(__dirname, "node_modules/@codemirror/state/dist/index.js"),
			"@codemirror/view": resolve(__dirname, "node_modules/@codemirror/view/dist/index.js"),
			"@codemirror/language": resolve(__dirname, "node_modules/@codemirror/language/dist/index.js"),
			"@lezer/common": resolve(__dirname, "node_modules/@lezer/common/dist/index.js"),
			"@lezer/highlight": resolve(__dirname, "node_modules/@lezer/highlight/dist/index.js"),
			"@lezer/html": resolve(__dirname, "node_modules/@lezer/html/dist/index.js"),
			"@lezer/lr": resolve(__dirname, "node_modules/@lezer/lr/dist/index.js"),
		},
	},
});
