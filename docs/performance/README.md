# Note-opening latency

Measured in the development vault using Obsidian 1.14.0, live preview with editable custom content. The installed experimental bundle differed from the tracked source, so both baselines were recorded. Images were already in the browser cache; these are not cold-network measurements.

The harness dispatches a click on the real file-explorer item and samples animation frames until the correct file's overlay has been applied and is no longer pending. `opened` records Obsidian's file-open event; `rendered` records the first animation-frame opportunity with the shell visible; `palette` additionally requires the image-derived stylesheet. This approximates presentation latency, not physical screen scanout or mouse hardware latency.

Four movies, three passes, with 600 ms between clicks to avoid Obsidian's double-click handling:

| Measurement | Original installed build | Fixed build |
| --- | ---: | ---: |
| First-pass fully colored view, median | 93.9 ms | 34.9 ms |
| First-pass fully colored view, range | 28.2–121.4 ms | 32.3–50.7 ms |
| All shell opens, median | 30.2 ms | 35.0 ms |
| Correct palette at first frame after resetting the memory cache | Delayed on first uncached visits | 12/12 opens |

The fixed run reused persisted poster colors after deleting the memory cache. The original build only had a memory cache, and checked it after image load. Shell-only timing is similar, slightly slower than the experimental build's retained-DOM cache in this sample; the major improvement is eliminating the second visible transition to the correct color. Compared with the tracked source baseline, initial shell rendering improved from 62–108 ms to 28–52 ms in the initial uncached-palette run.

On the loaded Spider-Man poster, the existing 256px color extraction took 44.6 ms on its first invocation and approximately 22 ms subsequently. Sampling at 64px took 13.3 ms first and approximately 3 ms subsequently. This processes 1/16 as many pixels; representative colors can shift slightly with downsampling. The existing OKLab clustering and palette construction are preserved.

## Changes

- Check the poster URL's cached color synchronously before image loading; persist up to 128 colors across restarts.
- Use the Obsidian theme background until a genuinely unknown poster loads; do not display the hardcoded blue fallback or cache failures as real colors.
- Ignore late image callbacks after their image has been removed from the template.
- Keep the CM6 editor and its extension configuration in place while preparing the next editable shell; move it once when ready.
- Render independent Markdown placeholders concurrently.
- Delegate link handling once per leaf, with the current source path, instead of retaining listeners for each discarded overlay.
- Discard editable shells completed after navigation changes the file.

The persisted colors are stored under `custom-views:movie-palettes:64-v1` in Obsidian's local storage. A changed URL naturally gets a new entry. If image bytes change at the exact same URL, clear this cache to resample. No note frontmatter is modified.

## Reproduce

```sh
node scripts/measure-latency.cjs
# Clear palette caches first, while leaving the browser's image cache alone:
node scripts/measure-latency.cjs --cold-palette
# Simulate a fresh runtime while retaining saved poster colors:
node scripts/measure-latency.cjs --reset-memory --output docs/performance/current-persisted-palette.json
```

## Latest verification

The current build was measured again after the render-coordination changes, with no build or test runner active. Raw results are in `current-persisted-palette.json` and `current-cold-palette.json`.

- Persisted palette, memory cache reset: median click-to-colored-view **34.6 ms**, range **23.4–58.4 ms** across 12 opens. All 12 had their palette on the first visible frame. First-pass median was **36.5 ms**.
- With both palette caches deleted: first-time colors appeared in **73.4–116.0 ms**. Three of four first-time opens showed the theme background briefly before extraction finished. Subsequent visits reused the calculated colors immediately. This deliberately cold case still depends on image readiness; it does not promise instant color for an unknown remote image.
- Superseded renders are canceled per pane, so slow work for an old note cannot queue up newer navigation or replace its result.

These are synthetic clicks on actual sidebar elements sampled at animation frames. They include Obsidian's opening work and are not a hardware click-to-photon measurement. Timing varies with system load; the original and current runs are separate sessions.

The installed movie customization is in ignored `data.json`. Its focused migration and tested replacement loader are tracked so the change can be reproduced without storing the rest of the user's settings or service credentials:

```sh
obsidian vault=obsidian-custom-views plugin:disable id=custom-views
node scripts/optimize-movie-view.cjs
obsidian vault=obsidian-custom-views plugin:enable id=custom-views
```

Validation: 956 tests, TypeScript/production build, and ESLint pass. Live checks cover rapid navigation, reading/source/live-preview transitions, return to an ordinary note, exactly one editor/overlay, and persisted colors at first paint. Remote poster loading remains subject to network latency on a genuinely new image.
