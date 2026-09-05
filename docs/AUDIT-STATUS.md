# Custom Views audit status

Status as of 2026-09-05: active. The checks below describe completed work and remaining verification, not a claim that every possible plugin issue has been eliminated.

## Branches

- `fix/native-filters-and-ux` contains the native filter integration and general fixes.
- `experiment/atomic-note-navigation` additionally contains the user-requested, unreleased navigation hooks. General fixes are copied into it so the installed development vault retains the flicker experiment. Obsidian's application binary has not been modified.

## Evidence reviewed

| Area | Current evidence |
| --- | --- |
| Native query UI | Native Bases factory/parser inspected in the installed bundle; actual editor mounted in the settings dialog; lifecycle and conversion regressions in `native-filters.test.ts`. |
| Settings edits | Tests cover serialized saves, retries after failures, stable deletion identity, stale reorder callbacks, immediate UI updates, and dialog cleanup. |
| Navigation | Tests cover cancellation, editable editor reuse, body and linked-note refreshes, and obsolete Canvas renders. The experimental branch also records frame-level navigation checks under `docs/performance/ATOMIC-NAVIGATION.md`. |
| Templates | Tests cover expression short-circuiting, selected conditional branches, own-property lookup, current editor content, and missing linked-note dependencies. |
| Editor usability | Native property registry used for autocomplete; labels on all three CodeMirror editors verified in the live dialog; scrolling limits tested against the shipped stylesheet. |
| Validation | Full tests, TypeScript/build, and lint were rerun after each completed fix. Latest installed code verification: 1,104 tests across 23 files; no captured live errors. Counts are historical and will change as the audit continues. |

## Remaining audit work

- Persisted settings are still accepted through a shallow assignment in `loadSettings`; malformed configuration recovery and preservation of recoverable data need a dedicated implementation and tests.
- Settings writes are serialized within an instance. Reloading while a disk write is pending needs verification across plugin instances.
- Legacy-to-native filter conversion has semantic edge cases. The current design avoids silent migration; a broader equivalence check remains useful before release.
- Popout windows, alternate themes, and mobile have not received the same live coverage as the current desktop vault.
- The retained navigation experiment has not been exhaustively verified with arbitrary third-party widgets or video.

The latency reports are measurements of specific builds and cache conditions. Their timing numbers should not be presented as current universal guarantees.
