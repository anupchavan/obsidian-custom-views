# Editor cleanup audit

Goal: remove the Preview context group tooltip; make the plugin mobile friendly;
review UI, duplication, efficiency, and lifecycle in multiple passes; add meaningful
regression coverage for each change and continue until diminishing returns.

## Pass 1: accessibility and narrow layout (2026-09-13)

- Replaced group aria-label (Obsidian's tooltip trigger) with aria-labelledby to
  hidden text. Individual context buttons retain their labels. Tested multiple
  groups for distinct references and absence of tooltip-trigger attributes.
- Narrow panes temporarily stack side-docked code below preview. Saved docking
  remains intact; wide panes recover it. Explicit top/bottom docking remains.
- Code sections stay vertical below 600px, including short keyboard-height layouts.
  A minimum section height and scrolling keep all visible editors reachable.
- Expanded coarse-pointer splitter hit areas without widening the visible border.
- Removed two loose test types detected by baseline lint.

Evidence: 1,298 tests across 40 files pass, lint passes, production build passes.
Build automatically synchronized Personal plugin artifacts. After reload, native
Obsidian mobile emulation reported app.isMobile=true. At 390px the editor stacked
vertically; both toolbar scrollWidths equaled their 390px clientWidths. The native
Bases note picker opened and there were no workbench role=alert errors. Group
aria-label was absent. Desktop narrow check showed full-width 390px panes and
160px minimum code sections in a scrollable panel, replacing 171px-wide code.

## Pass 2: native touch controls and settings

- Added a native ExtraButton and Menu alternative to desktop panel dragging.
  Boundary actions are disabled; hidden panels are excluded. Native menu regression
  coverage verifies ordering and single-panel behavior. Mobile headers permit
  vertical touch scrolling and describe the available reorder button.
- In Obsidian mobile emulation, selecting Move later moved HTML after CSS.
- Native Canvas corner resizing changed the selected note dimensions through
  CDP touch input. Side handles are deliberately non-interactive on mobile in
  Obsidian itself; corner handles are the native touch controls.
- Touching the native picker backdrop dismissed it. Touch dragging the workbench
  splitter moved it from y=477 to y=529.93 and persisted its ratio.
- Settings modal at 390px and 320px had three code editors, no overflowing setting
  rows, and scrollWidth equal to clientWidth (366px and 296px respectively).
- Floating navigation was covering the editor bottom. The workbench now reserves
  Obsidian's own --view-bottom-spacing, clamped to zero for keyboard states.
  The new live-app regression failed against the previous installed stylesheet
  and passed with the fix.

## Pass 3: lifecycle and efficiency

- A queued explicit JavaScript run survives a same-turn live-edit/metadata refresh.
  Tests cover coalescing, disabled scripts, closure, and absent notes.
- Canvas initialization now cleans up on failure, and disposal is idempotent.
  Tests inject failures during node creation and initial resize, and dispose twice.
- Deleted views retire their open editor controls and show an accessible status.
  Tests prevent stale editing and repeated disposal.
- All workbench subscriptions now use one Obsidian Component lifecycle, replacing
  the separate manual offref list. Event release and repeated close are tested.
- Metadata properties are fetched once per three-editor rebuild, not once per
  language. The regression constructs actual CodeMirror editors and checks call
  counts across rebuilds.
- Renamed the obsolete code-chooser helper to describe the inline code buttons.
- Reviewed native Bases adapters: their lifetimes differ (constructor discovery,
  live file-picker menu, cached query parser and per-modal filters). Retained those
  boundaries instead of combining incompatible owners into one abstraction.
- Reviewed existing renderer, embedded-view, settings, expression/editor and
  lifecycle paths. Existing scoping, cancellation, cached metadata, event-driven
  rendering and older-host discovery fallback remain covered by the full suite;
  no broad rewrite was justified by a demonstrated problem.

## Pass 4: regression and diminishing returns

The last review found only the splitter's stale aria-valuenow after double-click
reset and mobile header instructions advertising desktop dragging. Both now have
regression tests. Rechecking the changed paths found no further actionable issue
in scope that justified another behavioral change.

Repeatable live-app test:

```sh
node scripts/check-mobile-editor.mjs VAULT_NAME
```

The script creates only an in-memory view, restores the original list, closes its
temporary tab, clears device metrics, and restores mobile-emulation mode. It checks
320x568, 390x844, 390x390, 844x390 and 768x1024. All five pass: toolbars fit, context
labels remain accessible without group tooltips, reorder buttons exist, and the
content respects native bottom clearance (86px in the phone shell, 0px on tablet).
Temporary view IDs were confirmed absent from Personal's saved data.json, and
mobile emulation and test globals were cleared.

## Completion evidence

Final gates: 1,309 tests across 43 files pass; browser typecheck, lint and
production build pass; three deployment tests pass; git diff --check is clean.
Personal main.js and styles.css match the source artifacts byte for byte, and
the installed plugin was reloaded and confirmed active with no group tooltip.

| Requirement | Evidence |
| --- | --- |
| Remove Preview context tooltip | Group regression test and live-app attribute/accessibility checks |
| Mobile-friendly workbench and settings | Five viewport regressions; native touch reorder, resize, picker dismissal and splitter checks; 320/390px settings inspection |
| Clean up UI and code | Four passes above; shared lifecycle, single metadata lookup, failure cleanup, deleted-view state and native mobile controls |
| Tests for meaningful changes | Layout, reorder, scheduling, synchronization, surface, rebuild and live-app regression tests |
| Multiple passes until diminishing returns | Final pass produced only small accessibility corrections; changed paths rechecked |
| Consistent Personal installation | Successful build auto-sync; artifact verification; emulation reload loads installed build |

Verification uses Obsidian 1.14.1 desktop mobile emulation, not physical iOS/Android
hardware. User-authored templates can themselves contain fixed desktop layouts;
this work makes the plugin's controls/layout responsive without rewriting them.

Native references: [mobile development](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development),
[theme variables](https://docs.obsidian.md/Reference/CSS%20variables/About%20styling).
