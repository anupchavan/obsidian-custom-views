import tsparser from "@typescript-eslint/parser";
import tseslint from "@typescript-eslint/eslint-plugin";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslintConfigs from "typescript-eslint";

// Convert iterable to array and resolve 'extends' by spreading referenced configs
const recommendedConfigs = Array.from(obsidianmd.configs.recommended).flatMap(config => {
	if (config.extends) {
		// If config has 'extends', spread the extended configs first, then the current config
		const { extends: extendedConfigs, files: parentFiles, ...rest } = config;
		// Resolve extended configs (they should be arrays)
		const resolved = Array.isArray(extendedConfigs) ? extendedConfigs.flat() : [extendedConfigs];
		return [
			// Spread the extended configs, ensuring they inherit parent's files if needed
			...resolved.map(cfg => {
				// If the extended config doesn't have files, inherit from parent
				// This is critical for TypeScript type-checked rules
				if (!cfg.files && parentFiles) {
					return { ...cfg, files: parentFiles };
				}
				return cfg;
			}),
			// Then include the rest of the config (which already has files specified)
			rest,
		];
	}
	return config;
});

export default [
	// Global ignores (replaces .eslintignore)
	{
		ignores: ["node_modules/**", "main.js", "eslint.config.mjs", "*.config.mjs"],
	},
	// Use the converted configs, ensuring all have proper file filters
	...recommendedConfigs.map(config => {
		// If config has no files specified, don't apply it (or apply only to non-TypeScript files)
		if (!config.files) {
			// Configs without files should not apply TypeScript rules
			if (config.plugins?.["@typescript-eslint"] || config.rules?.["@typescript-eslint"]) {
				// Skip configs with TypeScript rules that don't have file filters
				return null;
			}
			// For other configs without files, apply to all files except .mjs
			return {
				...config,
				files: ["**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"],
			};
		}
		// Ensure TypeScript configs with type-checked rules only apply to .ts files
		if (config.files && config.files.some(f => f.includes("*.ts"))) {
			return {
				...config,
				files: config.files.filter(f => f.includes("*.ts") || f.includes("*.tsx")),
			};
		}
		return config;
	}).filter(Boolean), // Remove null entries
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				project: true,
				sourceType: "module",
			},
			globals: {
				// Browser globals
				document: "readonly",
				console: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				setInterval: "readonly",
				clearInterval: "readonly",
				requestAnimationFrame: "readonly",
				cancelAnimationFrame: "readonly",
				window: "readonly",
				// Node globals (for build scripts)
				process: "readonly",
				Buffer: "readonly",
			},
		},
		plugins: {
			"@typescript-eslint": tseslint,
		},
		rules: {
			// TypeScript rules
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"no-prototype-builtins": "off",
			"@typescript-eslint/no-empty-function": "off",
			// Allow unsafe any operations (Obsidian API uses any types)
			"@typescript-eslint/no-unsafe-assignment": "warn",
			"@typescript-eslint/no-unsafe-member-access": "warn",
			"@typescript-eslint/no-unsafe-call": "warn",
			"@typescript-eslint/no-unsafe-return": "warn",
			"@typescript-eslint/no-unsafe-argument": "warn",
		},
	},
];
