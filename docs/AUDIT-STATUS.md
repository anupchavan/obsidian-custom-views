# Custom Views audit status

Status as of 2026-09-05: active. The checks below describe completed work and remaining verification, not a claim that every possible plugin issue has been eliminated.

## Branches

- `fix/native-filters-and-ux` contains the native filter integration and general fixes.
- `experiment/atomic-note-navigation` additionally contains the user-requested, unreleased navigation hooks. General fixes are copied into it so the installed development vault retains the flicker experiment. Obsidian's application binary has not been modified.

## Evidence reviewed

| Area | Current evidence |
| --- | --- |
| Native query UI | Native Bases factory/parser inspected in the installed bundle; actual editor mounted in the settings dialog; lifecycle and conversion regressions in `native-filters.test.ts`. |
| Settings edits | Tests cover serialized saves across plugin reloads, malformed configuration recovery, retries after failures, stable deletion identity, stale reorder callbacks, immediate UI updates, and dialog cleanup. |
| Navigation | Tests cover cancellation, editable editor reuse, body and linked-note refreshes, and obsolete Canvas renders. The experimental branch also records frame-level navigation checks under `docs/performance/ATOMIC-NAVIGATION.md`. |
| Templates | Tests cover expression short-circuiting, selected conditional branches, own-property lookup, current editor content, and missing linked-note dependencies. |
| Editor usability | Native property registry used for autocomplete; labels on all three CodeMirror editors verified in the live dialog; scrolling limits tested against the shipped stylesheet. |
| Validation | Full tests, TypeScript/build, and lint were rerun after each completed fix. Latest installed code verification: 1,174 tests across 24 files; no captured live errors. Counts are historical and will change as the audit continues. |

## Remaining audit work

- Legacy-to-native filter conversion has semantic edge cases. The current design avoids silent migration; a broader equivalence check remains useful before release.
- Popout windows, alternate themes, and mobile have not received the same live coverage as the current desktop vault.
- The retained navigation experiment has not been exhaustively verified with arbitrary third-party widgets or video.

The latency reports are measurements of specific builds and cache conditions. Their timing numbers should not be presented as current universal guarantees.

## Settings recovery

The loader validates global switches, view fields, and filter tree shapes before use. Invalid views (including duplicate IDs) are skipped without changing valid view order or converting broken filters into match-all rules. Invalid global switches become off. Loading never saves the file. A recovery notice explains what happened; the original malformed configuration is retained under `recoveryData` in `data.json` on the next ordinary save, including templates and scripts from skipped entries. That backup survives later reloads and edits and can be used for manual recovery. Native formula syntax is still validated by Obsidian itself.

The navigation bar is now anchored consistently above both reading and live preview overlays, with a per-view Display options toggle. Live checks confirmed identical overlay positions and header visibility in both modes; the delayed navigation regression still reported no exposed native frames.

Checkbox conversion now uses the installed property-widget API and falls back to inferred registry widgets. Native parsing succeeded for true/false formulas for both assigned and inferred checkbox properties; evaluation matched the legacy boolean result on both existing notes with the inferred property. Regression tests also retain quoted values for text properties. Broader conversion equivalence remains open.

Exact-list conversion now compares sorted string values and retains duplicate counts. `node scripts/verify-legacy-list-conversion.cjs` compares 24 cases against the actual Bases parser and legacy matcher (both exact operators, reordered values, duplicates, numbers, booleans, links, empty lists, and scalars). All 24 agreed in the installed host. Negated native groups were separately checked against all four two-condition truth-table combinations and already matched legacy NOR.

Legacy containment conversion now preserves partial matches inside list items, scalar string conversion, empty searches, and all six positive/negative contains operators. The real-parser comparison script now covers 160 cases; the old converter disagreed in 50 cases and the corrected converter agreed in all 160. The verifier clears prior results and records parser exceptions per case so a failed run cannot reuse an earlier result.

Equality conversion now retains list membership and missing-value comparisons, with dynamic string comparison for unassigned scalar properties. Case-sensitive substring matching uses native literal split because native string contains ignores case. The live verifier now covers 320 cases, including null list entries, mixed-case terms, and literal regex punctuation, with no mismatches. Full tests/build/lint passed separately after the equality fix and after the case-sensitivity fix.

Prefix/suffix conversion now uses case-sensitive string slices, preserves empty search behavior, and leaves list values unmatched even for negated operators as the legacy matcher does. Emptiness conversion uses explicit list length and scalar/missing-value checks so boolean properties do not invoke an unsupported native method. The live suite now contains 624 comparisons, all agreeing; full tests/build/lint were run after each fix.

Numeric conversion now rejects missing, boolean, list, blank, invalid, and non-finite operands before comparison while retaining native numeric-string coercion (including hexadecimal and binary strings). Scientific-notation thresholds use the native number function because exponent literals are rejected by the parser. The live verifier now includes 1,254 comparisons, all agreeing with the legacy matcher.

Native filter load errors now provide an accessible alert and a Retry button. In-place retry is guarded against overlapping requests, stale buttons, and dialog closure; repeated disposal does not clear a reused host. The live app recovered from an injected initial failure into the actual native editor in two attempts, with zero saves, unchanged rules, and complete cleanup.
