// Mirrors the CSS checks in Obsidian's plugin review, so they show up before a release does.
// The review flags features that its target Chromium only partly supports, and any !important.
export default {
    plugins: ["stylelint-no-unsupported-browser-features"],
    rules: {
        "plugin/no-unsupported-browser-features": [true, { browsers: ["chrome 132"], severity: "warning" }],
        "declaration-no-important": [true, {
            message: "Avoid !important: raise the selector's specificity or use a CSS variable instead.",
        }],
    },
};
