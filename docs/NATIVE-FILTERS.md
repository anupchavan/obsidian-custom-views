# Native Bases filters

The Rules section of each view uses Obsidian's actual Bases filter editor. It is no longer a separately implemented copy. Enable the Bases core plugin before opening the editor.

The integration has been inspected and exercised in Obsidian 1.14.0. It uses internal APIs because Obsidian does not expose a public API for mounting this control. Discovery checks for a compatible editor and parser; if they are unavailable, the Rules section displays the error. Other view fields remain editable.

## Editing rules

Choose properties, operators, and values with the native pickers. Combine conditions with groups or switch a condition to an advanced formula. Changes save automatically. Rule order in the settings list determines which matching view is used first.

Existing configurations retain their legacy `rules` data. Opening a dialog converts those rules for display without writing a migration. Once a rule is edited, the native serialized filters are stored in `basesFilters` and evaluated by Bases. An empty native filter matches every file. If several views match, the first one wins.

Legacy and native operators are not universally interchangeable. Conversion uses native formulas to retain legacy list membership, order-independent exact matching, duplicate counts, and case-sensitive substring matching. These conditions may appear as advanced formulas in the native editor. Review the conditions when first editing a legacy view. A view without `basesFilters` continues using the legacy matcher; there is no automatic rewrite on startup.

## Implementation and lifecycle

- `src/native-filters/api.ts` discovers the registered `.base` embed factory, obtains its query parser using an in-memory receiver, and mounts its global filter builder. Discovery does not create or modify a vault file.
- `src/native-filters/editor.ts` ties the native control and save callback to the view dialog's lifetime.
- `src/native-filters/engine.ts` evaluates serialized filters with the native parser and Bases entries. It retains the legacy matcher for unmigrated views.
- `src/native-filters/convert.ts` converts legacy rules for the initial editor display.

Closing the dialog disposes native popovers and formula editors, removes the mounted control, and unloads its embed. A failure in one native disposer does not prevent the remaining cleanup. Late callbacks after disposal are ignored. Plugin unload closes open view dialogs.

## Verification

`src/__tests__/native-filters.test.ts` covers discovery, absence of vault writes, native save callbacks, legacy conversion, parser failures, unavailable controls, disposal, and delayed initialization. The real host has also been used to mount and close the native editor repeatedly and inspect its property pickers and groups.

Run the complete checks from the plugin repository:

```sh
npm test
npm run build
npm run lint
```
