## 0.2.0

### Editable content in live preview (experimental)

Custom Views no longer means giving up your editor. When enabled, the `{{file.content}}` area inside your template becomes a fully functional live editor — not a read-only render.

Everything you'd expect from the normal Obsidian editor works inside the template: slash commands, wikilink suggestions, embeds, Dataview blocks, undo/redo, and auto-save. The template wraps around the editor, so your layout (headers, sidebars, metadata panels) stays intact while the content area is editable.

**How it works:** The real CM6 editor is repositioned into the `{{file.content}}` placeholder in your template. Frontmatter is hidden automatically so only the body content is visible and editable.

**Requirements:**
- "Work in live preview" must be enabled.
- The template must contain an unfiltered `{{file.content}}` or `{{content}}` — piped variants like `{{file.content | markdown}}` remain read-only.
- Enable via Settings → Custom Views → "Editable content in live preview (experimental)."

### Per-view display options

Each view now has a **Display options** section (visible when editable content is enabled) with toggles for:
- **Show properties** — hide or show the metadata/properties section for that specific view.
- **Show inline title** — hide or show the inline title (only appears if Obsidian's global "Inline title" setting is on).

These work in both reading view and live preview, and are configurable independently per view.

### Auto-saving view settings

The Edit View modal no longer has Save/Cancel buttons. All changes — name, rules, template, display options — are saved automatically as you edit. No more forgetting to click Save.

### Bug fix: stale link resolution

Internal links in the template overlay now resolve relative to the currently active file rather than the file that was active when the overlay was first created. Previously, navigating between files that matched the same view could cause links to resolve against the wrong file path.
