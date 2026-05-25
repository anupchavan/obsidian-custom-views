# Contributing to Custom Views

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Development setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm (comes with Node.js)
- An [Obsidian](https://obsidian.md/) vault for testing

### Getting started

1. Clone the repo into your vault's plugin folder:

    ```bash
    cd <your-vault>/.obsidian/plugins/
    git clone https://github.com/anupchavan/obsidian-custom-views.git custom-views
    cd custom-views
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Start the dev build (watches for changes):

    ```bash
    npm run dev
    ```

4. In Obsidian, go to **Settings → Community plugins**, enable **Custom Views**, and reload when you make changes.

### Available scripts

| Command                 | What it does                           |
| ----------------------- | -------------------------------------- |
| `npm run dev`           | Watch mode — rebuilds on every save    |
| `npm run build`         | Production build (type-check + bundle) |
| `npm run lint`          | Run ESLint                             |
| `npm run lint:fix`      | Run ESLint with auto-fix               |
| `npm test`              | Run all tests once                     |
| `npm run test:watch`    | Run tests in watch mode                |
| `npm run test:coverage` | Run tests with coverage report         |

## Project structure

```
src/
  main.ts               # Plugin entry point and lifecycle
  settings.ts           # Settings tab, filter builder UI, edit view modal
  renderer.ts           # Template rendering engine
  matcher.ts            # Filter rule matching logic
  filters.ts            # Filter chain functions (date, text, array, etc.)
  expression.ts         # Expression engine (Bases-style expressions)
  editor.ts             # CodeMirror 6 editor setup for template editing
  editable-content.ts   # CM6 extensions for editable content mode
  suggests.ts           # Autocomplete suggest providers (files, folders, tags)
  types.ts              # TypeScript interfaces and types
  __tests__/            # Vitest test files (788 tests)
```

Key root files:

- `manifest.json` — Obsidian plugin manifest (ID, version, min app version)
- `styles.css` — Plugin stylesheet
- `esbuild.config.mjs` — Build configuration
- `versions.json` — Maps plugin versions to minimum Obsidian versions

## How to contribute

### Reporting bugs

Please [open an issue](https://github.com/anupchavan/obsidian-custom-views/issues/new/choose) using the **Bug report** template. Include:

- Steps to reproduce the issue
- What you expected vs. what happened
- Your Obsidian version and OS
- Screenshots or screen recordings if applicable
- Whether the issue happens with other plugins disabled

### Suggesting features

Use the **Feature request** template to propose new functionality. Explain the use case and why it would be useful.

### Submitting pull requests

1. Fork the repo and create a branch from `main`.
2. Make your changes in `src/`.
3. Add or update tests for any changed behavior — run `npm test` to confirm all 788+ tests pass.
4. Run `npm run build` and `npm run lint` to verify the build is clean.
5. Open a PR with a clear description of what changed and why.

### Code style

- TypeScript with strict null checks enabled.
- Keep `main.ts` focused on plugin lifecycle — delegate logic to other modules.
- Use `this.register*` helpers for all event listeners and intervals (ensures clean unload).
- Follow Obsidian's sentence-case convention for UI text.
- No `!important` in CSS — use specificity or CSS classes instead.
- No network requests without user-facing justification and explicit opt-in.
- Run `npm run lint` before committing.

### Testing

Tests use [Vitest](https://vitest.dev/) and live in `src/__tests__/`. The test suite mocks Obsidian's API surface so tests run without a real vault.

To add tests for a new feature, create or extend the relevant test file (e.g., `renderer.test.ts` for template changes, `matcher.test.ts` for filter logic).

## Known issues

The following are known bugs being tracked. If you're looking for a good first contribution, fixing one of these would be very welcome.

- **File navigation focus lost after keyboard shortcut**: Clicking a file in the file explorer and then pressing Cmd/Ctrl + Up/Down works once, but subsequent presses lose focus from the file navigator. This is caused by the plugin's view injection triggering Obsidian's layout-change events, which interfere with the file explorer's focus state.

- **Properties not visible in reading view**: The per-view "Show properties" toggle only works in editing view (live preview). In reading view, `MarkdownRenderer.render()` does not produce the native `.metadata-container` or `.inline-title` elements, so there is nothing to show or hide. A proper reading-view solution is planned for a future release.

## Questions

If you have questions about the codebase or how something works, feel free to open a [discussion](https://github.com/anupchavan/obsidian-custom-views/discussions) or reach out by opening an issue.
