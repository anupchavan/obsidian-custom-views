
Create custom HTML, CSS, and JavaScript views for Obsidian notes based on matching rules.

![Custom Views example](https://github.com/user-attachments/assets/f94e92b6-93a0-42eb-a9c7-bad6bc3aa7e2)

Custom Views lets structured notes render as purpose-built pages while keeping the data in normal Markdown files. Use it for movie pages, album pages, catalogs, dashboards, project views, reading lists, and any note type that benefits from a custom layout.

## What it does

- Matches notes using file data, tags, folders, and frontmatter properties.
- Renders matching notes with HTML templates.
- Supports placeholders, filters, conditionals, loops, and expressions.
- Can render note content and wikilinks with Obsidian's Markdown renderer.
- Can query Obsidian Bases from inside a template.
- Supports scoped CSS and optional JavaScript for trusted templates.

## Getting started

1. Enable the plugin in **Settings -> Community plugins**.
2. Open **Settings -> Custom Views**.
3. Add a view and choose the rules that decide which files it applies to.
4. Add an HTML template, then optional CSS and JavaScript.
5. Open a matching note in reading mode or live preview.

The first matching view is used, so place more specific views above broader ones.

## Documentation

The detailed documentation lives in the GitHub Wiki:

- [Wiki home](https://github.com/anupchavan/obsidian-custom-views/wiki)
- [Quick start](https://github.com/anupchavan/obsidian-custom-views/wiki/Quick-start)
- [Template syntax](https://github.com/anupchavan/obsidian-custom-views/wiki/Template-syntax)
- [Filters and functions](https://github.com/anupchavan/obsidian-custom-views/wiki/Filters-and-functions)
- [Bases in Custom Views](https://github.com/anupchavan/obsidian-custom-views/wiki/Bases-in-Custom-Views)
- [Movie view tutorial](https://github.com/anupchavan/obsidian-custom-views/wiki/Movie-view-tutorial)
- [Album view tutorial](https://github.com/anupchavan/obsidian-custom-views/wiki/Album-view-tutorial)
- [Troubleshooting](https://github.com/anupchavan/obsidian-custom-views/wiki/Troubleshooting)

GitHub stores the wiki as a separate repository named `obsidian-custom-views.wiki.git`; each wiki page is a Markdown file in that repository.

## JavaScript safety

Template JavaScript is powerful and runs inside Obsidian when the view renders. Only enable JavaScript for templates you trust, and avoid pasting scripts from unknown sources.

JavaScript template execution is powered by [`@silentvoid13/rusty_engine`](https://github.com/SilentVoid13/rusty_engine), the WASM engine created for [Templater](https://github.com/SilentVoid13/Templater).

## Development

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
```

Release artifacts are generated at the plugin root for Obsidian: `main.js`, `manifest.json`, and `styles.css`.

## Contributing

Issues and pull requests are welcome. If you are reporting a rendering problem, include the view rule, template, relevant frontmatter, and any console error.
