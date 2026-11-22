/**
 * Every Obsidian internal (not in the public `obsidian` typings) that Custom Views relies on.
 *
 * Obsidian minifies its own code but keeps property and method names, so a name that
 * disappears from app.js means a rename or removal that will break the plugin. That is
 * exactly how #37 happened: 1.15 replaced `setGlobalFilters` with `setFilters`.
 *
 * Each entry passes when every name in at least one of its `anyOf` groups is present.
 * When an Obsidian release adds a second shape for something, add it as a new group
 * instead of replacing the old one, so older supported versions keep passing.
 * Add an entry whenever the source starts using another internal.
 */
export const INTERNALS = [
	// Bases embed factory: native filters, code buttons, note picker, Bases data provider.
	{ id: "bases-embed-factory", usedBy: "src/native-filters/api.ts, src/bases/provider.ts, src/view-editor-native.ts, src/view-editor-note-picker.ts", anyOf: [["embedRegistry", "embedByExtension"]] },
	{ id: "bases-load-query", usedBy: "src/native-filters/api.ts (discover)", anyOf: [["loadQuery", "saveFn"]] },
	{ id: "bases-query-save-global-filters", usedBy: "src/native-filters/api.ts (setGlobalFilters)", anyOf: [["setGlobalFilters"], ["setFilters"]] },
	{ id: "bases-query-view-config", usedBy: "src/native-filters/api.ts", anyOf: [["getViewConfig"]] },
	{ id: "bases-controller-context", usedBy: "src/native-filters/api.ts", anyOf: [["buildBasesContext"]] },
	{ id: "bases-filter-menu", usedBy: "src/native-filters/api.ts (globalBuilder)", anyOf: [["filterMenu", "globalFilterBuilder", "innerContainerEl"], ["filterMenu", "filterEditor", "baseSection", "innerEl"]] },
	{ id: "bases-filter-toolbar", usedBy: "src/native-filters/api.ts (mobile and popover Rules)", anyOf: [["toolbarItem", "scrollEl", "mobileTitleEl"], ["toolbarItem", "createPage", "mobileTitleEl"]] },
	{ id: "bases-filter-cleanup", usedBy: "src/native-filters/api.ts (destroyFormulaEditors)", anyOf: [["advancedInputEditor", "leftInputEl", "operatorComponent"]] },
	{ id: "bases-property-menu-button", usedBy: "src/view-editor-native.ts", anyOf: [["propertyMenu", "toolbarItem"]] },
	{ id: "bases-view-menu", usedBy: "src/view-editor-note-picker.ts", anyOf: [["viewMenu", "renderViews", "searchComponent", "setSuggestions", "renderSuggestion", "onNext", "bgEl"]] },
	{ id: "bases-embed-lifecycle", usedBy: "src/bases/provider.ts", anyOf: [["containingFile", "loadFile", "runnable", "errorEl"]] },
	// Canvas preview surface in the view editor.
	{ id: "canvas-view-factory", usedBy: "src/view-editor-surfaces.ts", anyOf: [["viewRegistry", "viewByType"]] },
	{ id: "canvas-internals", usedBy: "src/view-editor-surfaces.ts, src/main.ts", anyOf: [["createFileNode", "selectOnly", "setViewport", "zoomToSelection", "saveLocalData", "alwaysKeepLoaded", "wrapperEl"]] },
	// Panel reordering in the view editor.
	{ id: "drag-manager", usedBy: "src/view-editor-layout.ts", anyOf: [["dragManager", "handleDrag", "handleDrop", "showOverlay", "updateSource", "onDragEnd"]] },
	// Native link context menus in rendered views.
	{ id: "link-context-menus", usedBy: "src/main.ts", anyOf: [["handleLinkContextMenu", "handleExternalLinkContextMenu"]] },
	// Property types for rule conversion and template diagnostics.
	{ id: "metadata-type-manager", usedBy: "src/native-filters/convert.ts, src/template-properties.ts", anyOf: [["metadataTypeManager", "getAssignedWidget", "getAllProperties"]] },
	// Vault config keys read with vault.getConfig.
	{ id: "vault-config-keys", usedBy: "src/main.ts, src/settings.ts", anyOf: [["getConfig", "propertiesInDocument", "showInlineTitle"]] },
	// Markdown embeds that render views inside other notes.
	{ id: "markdown-embed-modes", usedBy: "src/embedded-views.ts", anyOf: [["editMode", "sourceMode", "editorEl"]] },
	// The modal's settings host, closed before opening the view editor.
	{ id: "settings-host", usedBy: "src/settings.ts", anyOf: [["openTabById", "activeTab"]] },
];

const escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Returns one result per entry; `ok` is false when no group is fully present. */
export function checkInternals(source) {
	const present = new Map();
	const has = name => {
		if (!present.has(name)) present.set(name, new RegExp(`(^|[^\\w$])${escape(name)}([^\\w$]|$)`).test(source));
		return present.get(name);
	};
	return INTERNALS.map(entry => {
		const groups = entry.anyOf.map(group => ({ group, missing: group.filter(name => !has(name)) }));
		const match = groups.find(g => g.missing.length === 0);
		return { ...entry, ok: Boolean(match), matched: match?.group ?? null, missing: match ? [] : groups.map(g => g.missing) };
	});
}
