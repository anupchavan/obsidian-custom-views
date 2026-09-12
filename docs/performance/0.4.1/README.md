# 0.4.1 rendering and cleanup audit

Measured in the development vault on Obsidian 1.14.1 on September 12, 2026. These are development measurements, not universal latency or battery-life guarantees.

## Canvas transitions

The existing contact example was exercised with real pointer clicks. A requestAnimationFrame sampler recorded 45 frames for each direction. `canvas-enter.json` and `canvas-exit.json` contain the samples; `hold` identifies the retained view covering a pending render.

No sampled frame lacked both a ready overlay and a retained view. Entering live preview held the previous view while the native editor iframe changed height from 299 to 307 pixels, then removed the hold at approximately 91 ms. The card's sampled height remained 617 pixels. These checks observe DOM readiness at animation frames; they do not measure physical screen scanout, and do not establish behavior for arbitrary remote widgets or video.

A repeated `showPreview()` call on a node already in reading mode removed its overlay before the fix. After the fix the same overlay remained mounted. Regression tests cover this and obsolete asynchronous callbacks.

## Work reduction

- Modern hosts with a Markdown embed factory no longer run the one-second discovery/refresh interval. A three-second quiet-window probe of the running embed manager recorded zero refresh calls. Older hosts retain a discovery fallback.
- DOM changes outside tracked embed roots no longer run matching and render checks for every embed.
- Canvas traversal refreshes the current node instead of refreshing every tracked embed once per Canvas node.
- Metadata events refresh affected embedded notes and linked-note dependencies. Pending renders are coalesced; superseded callbacks cannot reset the current view.
- Parsed expressions use a FIFO cache of at most 128 expressions, each at most 4,096 characters. Only syntax is cached, never note values or evaluation context.

The parser microbenchmark cycled four expressions 20,000 times per pass for six passes in Vitest. After warm-up, uncached passes took 15.1–16.0 ms and cached passes took 0.3–0.6 ms. Raw timings are in `parse-before.json` and `parse-after.json`. This isolates parsing and is not an end-to-end note-opening benchmark.

## Knap and compatibility

Knap 0.4.2 owns filter-chain/argument parsing and supplies the standard filter registry. Custom Views overrides preserve existing typed results, date conventions, vault-related behavior, and HTML handling where semantics differ. In particular, the existing tag-removal path keeps encoded HTML encoded; Knap's strip_tags also decodes entities. The host expression language remains necessary for Bases-style function calls and file resolution.

Completion names come from the active registry. The running editor matched `flcnt` to `file.content`; matching spans had font weight 700 versus 400 for the surrounding label. CodeMirror already provides this behavior, so no separate fuzzy matcher or highlight renderer was added. The temporary Contacts-template edit used for this check was restored exactly.

## Scope and remaining limits

The passes addressed redundant discovery, repeated rendering, stale callbacks, shared filter parsing, repeated expression parsing, and the observed editor UI issues. Remaining layout work is driven by native editor sizing or actual content changes. Further removal of lifecycle handling would need new evidence of a bottleneck; these results do not justify weakening cleanup or compatibility safeguards.

The measurements cover this desktop vault and its loaded example. Mobile, arbitrary third-party widgets, remote-media first loads, and every theme are not claimed to have identical timing or rendering behavior. The development-only movie palette migration and its fixture tests were archived outside the plugin repository; the template folder is no longer shipped.
