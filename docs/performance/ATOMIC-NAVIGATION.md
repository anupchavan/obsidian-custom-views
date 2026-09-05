# Atomic note navigation experiment

Originally developed on `experiment/atomic-note-navigation`, based on `fix/native-filters-and-ux` at `0a089ea`. Merged into `main` at the user’s request on 2026-09-05; no release has been published for this work. The Obsidian binary was not modified.

Obsidian populates MarkdownView before emitting `file-open`. Replacing the normal view in that event leaves a presentation gap. This experiment wraps `WorkspaceLeaf.setViewState` and `MarkdownView.setState` before the native load starts, holds the previous note, awaits native loading and the custom render, then reveals the completed view without a fade.

The installed strategy retains the actual old custom shell, copies only its editable text area, and moves the real CM6 editor into the hidden working view. The old stylesheet receives a separate scope so the next palette cannot recolor it. ResizeObserver measures bounds after rendering to avoid forcing layout at click time. Unload restores the prototype methods, visibility, and observers.

The installed bundle's `setViewState` also silently returns when `leaf.working` is true. Waiting for custom rendering widened that window and caused rapid clicks to be dropped. Requests now queue before this guard, independently per pane, and the visual hold remains until pending navigation finishes.

## Measurements

Four movies, three passes, synthetic clicks on actual sidebar elements, sampled at animation frames. Posters and their persisted palettes were cached. Hook-disabled and retained runs were sequential on the final build without tests/builds running. The compositor run was an earlier experiment in the same session. Scheduling varies, including the 170.5 ms outlier in the disabled run. These are presentation opportunities, not hardware click-to-photon measurements.

| Strategy | Median click → colored view | Range, 12 opens |
| --- | ---: | ---: |
| Hook disabled | 38.0 ms | 24.2–170.5 ms |
| Retained shell (enabled) | 47.1 ms | 42.2–63.4 ms |
| Compositor snapshot (alternative) | 99.8 ms | 78.7–131.3 ms |

The retained strategy adds about 9 ms to the median in this comparison. Its improvement is visual continuity. All 12 retained opens had the correct palette on the first visible frame.

With a deliberate 200 ms delay at the custom render entry point, disabling the hook exposed **27 intermediate frames** when entering a movie from an ordinary note. Enabling it exposed **zero** intermediate native/blank frames across ordinary → movie, movie → movie, movie → album, and reading/source/live-preview changes. Five three-note bursts all ended on the last requested note, with one editor, one correct overlay, and no remaining hold.

A before/during screenshot comparison while rendering was paused found **zero changed pixels** in the tested note viewport. See `atomic-visual-check.json`, `atomic-live-checks.json`, and `atomic-live-before.json` for evidence.

The initial full DOM-copy approach was rejected because it shifted the image under Obsidian's layout containment. Chromium's View Transition API held exact pixels but added substantially more latency; it remains available for comparison. Retained DOM allows an old async widget to finish updating while held. Arbitrary third-party widgets, video, popout windows, and all themes have not been exhaustively tested.

## Reproduce

```sh
node scripts/measure-latency.cjs --frames --output docs/performance/atomic-retained.json
node scripts/verify-atomic-navigation.cjs
```

In Obsidian's developer console:

```js
const navigation = app.plugins.plugins["custom-views"].experimentalNavigation;
navigation.enabled = false; // Compare the normal event-based renderer.
navigation.enabled = true;
navigation.strategy = "compositor"; // Slower pixel-snapshot comparison.
navigation.strategy = "retained";   // Installed default.
```

974 unit/regression tests, TypeScript/production build, and ESLint pass. The app remains on the retained strategy with the hook enabled. These navigation tests did not modify note contents or saved view configurations.
