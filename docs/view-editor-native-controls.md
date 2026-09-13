# View editor controls

Verified against the installed Obsidian 1.14.1 bundle. These internal adapters are intentionally local to the editor's own component instances. They do not patch Obsidian prototypes or load a hidden Base file.

- `ItemView.onPaneMenu` supplies the navigation menu. `MenuItem.setSubmenu` is the native internal submenu method.
- Bases' registered embed factory supplies unmounted controller instances; only the needed toolbar components are attached. No query or user file is loaded to discover their constructors.
- Code visibility uses Bases' actual text-icon button constructor in an inline row. Its native click and keyboard handlers toggle `.is-active` and `aria-pressed`. No checkbox menu remains.
- Context selection uses public `ExtraButtonComponent` instances in a small flex row with a single active state. No segmented/group component was found in the installed API declarations or bundle; only the row layout and selection state are local.
- The note picker is the actual Bases view menu, including its button, chevrons, anchored popover, search input, and keyboard chooser. Its data source is notes matching the selected template's rules, independently of whether the template is enabled. Native `prepareSimpleSearch` supplies search. View creation/configuration actions are excluded.
- The rules button uses the existing native filter-builder adapter inside its native toolbar popover, labeled Rules. A template has one rule scope.
- `Workspace.openPopoutLeaf` hosts undocked code. `EditorView.setRoot` transfers the same editors to the new document. Closing that window redocks them; closing the owner disposes them.
- Heading dragging uses `app.dragManager.handleDrag`, `handleDrop`, `updateSource` and `showOverlay`. Obsidian creates and cleans up the drag ghost, action label and animated workspace overlay. A custom draggable type restricts drops to the same editor. Alt+arrow reordering remains available. Splitter geometry uses pointer capture and keyboard controls; ResizeObserver selects panel orientation.
- Draggable gaps use `--border-width` and `--background-modifier-border`, with an invisible wider pointer hit area. Knap's inspected `website/src/scripts/playground-columns.ts` uses adjacent resizers, pointer capture, keyboard adjustments and equal-size reset; it is not an Obsidian component.

The preview calls the existing template renderer. Selecting a note or explicitly running JavaScript starts a new iframe realm. Live HTML/CSS changes render into a detached staging container and apply only authored differences to the existing preview. A baseline captured before JavaScript distinguishes template edits from runtime state, preserving unchanged images, palette attributes, listeners and script-created content. Scroll positions are captured at commit and restored. Stale asynchronous results are discarded. Replacing/closing the frame aborts outstanding renders, unloads Markdown components and disconnects style observers.

Runtime checks in Personal (2026-09-13): HTML/CSS edits retained the iframe and image identities, script-set palette state, and a 600px preview scroll. Hiding CSS left two panels filling 947.89px of a 948.89px area plus a 1px divider. Native drag events created the Obsidian ghost and workspace overlay, reordered panels and cleaned up the ghost on drop. The full suite passed 1,286 tests before adding preview lifecycle regression tests.

## Context surfaces and headers

- Language headers use public `Setting.setHeading()` and `addExtraButton()` for Run JavaScript, with the theme border width and square corners. The toolbar no longer has a Code label or a persistent save-status footer; errors use `Notice`.
- Preview windows use a shared event bridge following Obsidian's embedded-editor window integration. It relays input to the host so native menu dismissal and shortcuts work inside the iframe. The note picker and Rules use their existing native outside-click handlers; no picker-specific backdrop override remains.
- Popover uses the native `popover hover-popover` classes and `--popover-width`, `--popover-height`, and `--popover-max-height`. A centered presentation wrapper changes placement only; theme styles provide radius, border and shadow. Its icon is `scan-eye`.
- Canvas uses the registered Canvas view factory to obtain the actual canvas controller. It mounts a native file node using Canvas's default dimensions, with the existing preview renderer as its child. The surface never opens or saves a canvas file. Native drag, pan, zoom and resize interactions remain native; disposal unloads the canvas and child. Native card-creation toolbar is hidden for this single-note preview.
- Live checks: a native edge drag resized the node from 400 to 500 pixels; a subsequent HTML edit preserved the same iframe and resized node. Popover frame dimensions matched the active theme's 450 by 400 variables, with centered placement. The note picker closed through its native backdrop when clicking over the preview.

Canvas preview restrictions: detach the factory-created ItemView container immediately, retaining only its canvas wrapper, so the editor leaf has exactly one view container. Native `zoomToSelection()` fits the initial note. Lifecycle-managed capture guards reject creation/editing events (double-click, context menus, drops, paste/cut, deletion, duplication/modifier drags). The card toolbar, selection menu, global controls and connection handles are hidden; native plain dragging, wheel pan/zoom and edge resizing remain. Runtime checks confirmed zero extra view containers and one node after creation attempts.

## Editor synchronization and note switching

`saveSettings()` emits a public Obsidian `Events` notification after the existing debounced write succeeds. Each editor owns a `Component.registerEvent` subscription that is unloaded with it. Synchronization compares effective context fields and applies a minimal CodeMirror text change without rebuilding editors or creating save loops. HTML/CSS changes schedule a preview update; JavaScript text synchronizes without running. Rule changes refresh the matching-note picker and native Rules control. No polling or prototype patches are used for synchronization.

Note switches prepare a new preview session in a hidden layer at its final dimensions while retaining the current preview. Completion swaps the layers without reparenting a live iframe. Superseded renders are discarded, and image waits are bounded and cancelled on replacement/disposal. Live edits of the same note still patch the existing session. Header heights reserve the theme's input height plus native spacing and border variables, since Obsidian hides empty Setting control elements. The placement menu is labeled Code panel position.

## Live update and drop regressions

- Staged stylesheet updates transfer their trusted scoping metadata to retained style elements. The scope observer does not wrap them twice or replace text nodes still tracked by the live renderer. Repeated HTML/CSS edits and reversions are covered by regression tests.
- Native panel drop handlers register in capture phase for workbench panel drags, before CodeMirror can interpret the drag label as text. Ordinary text and file drops remain with the editor.
