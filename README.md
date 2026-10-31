# Custom Views

Turn structured notes into purpose-built pages. Custom Views renders matching notes with your own HTML, CSS and JavaScript, while the data stays in ordinary Markdown and frontmatter.

![Custom Views example](https://github.com/user-attachments/assets/f94e92b6-93a0-42eb-a9c7-bad6bc3aa7e2)

A movie note can look like a film page, an album like a record sleeve with its tracklist, a recipe like a card. Edit the note as usual, and the view updates with it.

## Install

Search for **Custom Views** in **Settings → Community plugins → Browse**, install it, and enable it.

To try the latest beta, install [BRAT](https://github.com/TfTHacker/obsidian42-brat) and add `anupchavan/obsidian-custom-views` as a beta plugin.

Custom Views uses Obsidian's Bases filters for its rules, so turn on **Bases** in **Settings → Core plugins**.

## Your first view

1. Open **Settings → Custom Views** and add a view.
2. Under **Rules**, choose which notes it applies to: a folder, a tag, a property value, or any combination, using the same filter editor as Bases.
3. Write an HTML template, and optionally CSS and JavaScript.
4. Open a matching note in reading view or live preview.

The first matching view wins, so put specific views above broad ones. Changes save automatically.

## Templates

Templates are HTML with placeholders for the note's properties:

```html
<div class="movie">
  <img src="{{poster}}" alt="{{title}}">
  <h1>{{title}} <span>{{released | date:"YYYY"}}</span></h1>

  {% if rating >= 8 %}<p class="badge">Favourite</p>{% endif %}

  <ul>
    {% for actor in cast %}<li>{{actor}}</li>{% endfor %}
  </ul>

  {{file.content}}
</div>
```

- **Properties** come from frontmatter, plus built-ins like `file.basename`, `file.folder`, `file.mtime` and `file.content` (the note body, rendered as Markdown).
- **Linked notes** can be followed through wikilinks. If `director` is `[[Christopher Nolan]]`, then `{{director[0].born}}` reads a property from that note.
- **Filters** transform values: `upper`, `date`, `join`, `split`, `map`, `unique`, `round`, `markdown`, `wikilink` and many more.
- **Logic** covers `{% if %}`, `{% for %}` and `{% set %}`, with `and`, `or`, `not`, comparisons and `??` for fallbacks.
- **Bases** can be queried from inside a template with a `{% base %}` block, so an album view can list every song that links back to it.

CSS is scoped to the view, so it won't leak into the rest of Obsidian.

## View editor

Run **Custom Views: Open view editor** from the command palette, or open it from settings, to edit a view beside a live preview. Pick any matching note to preview against, rearrange or dock the HTML, CSS and JavaScript panels, or pop them out into their own window on desktop.

The editors check your code as you type. Unclosed tags, broken expressions, unknown filters, misspelled property names and JavaScript errors are underlined where they happen, with a message at the end of the line and a hint on how to fix it.

## Beyond the main note

Views can also apply in **popover previews**, **Canvas** cards and **embedded notes**. Turn each on in settings. In a view's editor, **Template for** lets each of these contexts inherit the main template or override its HTML, CSS or JavaScript separately, for example a compact card for hover previews.

With **Editable content in live preview** on, `{{file.content}}` becomes the native editor, so you can write in the note without leaving the view.

From a note's menu you can jump to its view's editor, turn the view off everywhere, or pause it for the current tab.

## JavaScript

Views can run JavaScript when the view renders. Scripts run inside Obsidian with full access to your vault, so only use scripts you wrote or trust. Turn off **Allow JavaScript execution** in settings to disable them entirely.

## Documentation

The [wiki](https://github.com/anupchavan/obsidian-custom-views/wiki) covers everything in depth:

- [Quick start](https://github.com/anupchavan/obsidian-custom-views/wiki/Quick-start)
- [Template syntax](https://github.com/anupchavan/obsidian-custom-views/wiki/Template-syntax)
- [Filters and functions](https://github.com/anupchavan/obsidian-custom-views/wiki/Filters-and-functions)
- [Bases in Custom Views](https://github.com/anupchavan/obsidian-custom-views/wiki/Bases-in-Custom-Views)
- [Movie view tutorial](https://github.com/anupchavan/obsidian-custom-views/wiki/Movie-view-tutorial)
- [Album view tutorial](https://github.com/anupchavan/obsidian-custom-views/wiki/Album-view-tutorial)
- [Troubleshooting](https://github.com/anupchavan/obsidian-custom-views/wiki/Troubleshooting)

## Contributing

Issues and pull requests are welcome. When reporting a rendering problem, include the view's rules, template, the note's frontmatter and any console error. See [CONTRIBUTING.md](CONTRIBUTING.md) to set up a development build.

## License

[MIT](LICENSE)
