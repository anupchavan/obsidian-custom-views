import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
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
