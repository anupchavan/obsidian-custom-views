import { defineConfig } from "eslint/config";
import tseslintConfigs from "typescript-eslint";
import tsparser from "@typescript-eslint/parser";
import tseslint from "@typescript-eslint/eslint-plugin";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
    { ignores: ["node_modules/**", "main.js", "eslint.config.mjs", "*.config.mjs", "vitest.config.ts", "package.json", "scripts/**"] },
    // Obsidian's plugin rules apply to shipped code, not the Node-based test harness.
    {
        files: ["src/**/*.ts"],
        ignores: ["src/__tests__/**"],
        extends: [...obsidianmd.configs.recommended],
    },
    {
        files: ["src/__tests__/**/*.ts", "__mocks__/**/*.ts"],
        extends: [...tseslintConfigs.configs.recommendedTypeChecked],
        // Async fixture implementations intentionally model promise-returning host APIs.
        rules: { "@typescript-eslint/require-await": "off" },
    },
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
                // Obsidian popout-window globals
                activeDocument: "readonly",
                activeWindow: "readonly",
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
    // Check production code without ambient Node types masking missing browser libraries.
    {
        files: ["src/**/*.ts"],
        ignores: ["src/__tests__/**"],
        languageOptions: { parserOptions: { project: "./tsconfig.browser.json" } },
        rules: { "obsidianmd/prefer-create-el": "error" },
    },
    // Test files: vitest types aren't resolved by the project tsconfig,
    // so disable type-checked rules that produce false positives.
    {
        files: ["src/__tests__/**/*.ts"],
        rules: {
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-return": "off",
        },
    },
]);
