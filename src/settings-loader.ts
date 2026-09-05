import { DEFAULT_SETTINGS, type CustomViewsSettings } from "./settings";
import type { ViewConfig } from "./types";

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

const operators = new Set([
	"=", "≠", "<", "≤", ">", "≥", "contains", "does not contain",
	"contains any of", "does not contain any of", "contains all of", "does not contain all of",
	"is", "is not", "is exactly", "is not exactly", "starts with", "does not start with",
	"ends with", "does not end with", "is empty", "is not empty", "links to", "does not link to",
	"in folder", "is not in folder", "has tag", "does not have tag", "has property", "does not have property",
	"on", "not on", "before", "on or before", "after", "on or after",
]);

function legacyRule(value: unknown, depth = 0): boolean {
	if (!record(value) || depth > 100) return false;
	if (value.type === "group") return ["AND", "OR", "NOR"].includes(String(value.operator)) &&
		Array.isArray(value.conditions) && value.conditions.every(child => legacyRule(child, depth + 1));
	return value.type === "filter" && typeof value.field === "string" &&
		typeof value.operator === "string" && operators.has(value.operator) &&
		(value.value === undefined || typeof value.value === "string");
}

function nativeFilter(value: unknown, depth = 0): boolean {
	if (typeof value === "string") return true;
	if (!record(value) || depth > 100) return false;
	const keys = Object.keys(value);
	const children = value[keys[0]];
	return keys.length === 1 && ["and", "or", "not"].includes(keys[0]) &&
		Array.isArray(children) && children.every(child => nativeFilter(child, depth + 1));
}

function validView(value: unknown): value is ViewConfig {
	if (!record(value)) return false;
	return typeof value.id === "string" && value.id.length > 0 && typeof value.name === "string" &&
		typeof value.template === "string" && record(value.rules) && value.rules.type === "group" && legacyRule(value.rules) &&
		(value.basesFilters == null || nativeFilter(value.basesFilters)) &&
		["css", "js"].every(key => value[key] === undefined || typeof value[key] === "string") &&
		["showProperties", "showInlineTitle", "showNavigationBar"].every(key => value[key] === undefined || typeof value[key] === "boolean");
}

/** Invalid entries are kept in recovery data, never converted into match-all views. */
export function loadValidatedSettings(data: unknown): { settings: CustomViewsSettings; recovered: boolean } {
	const defaults = structuredClone(DEFAULT_SETTINGS);
	if (data == null) return { settings: defaults, recovered: false };
	const source = record(data) ? data : {};
	let recovered = !record(data);
	const settings: CustomViewsSettings = { ...source, ...defaults };
	for (const key of ["enabled", "workInLivePreview", "workInCanvas", "editableContent", "allowJavaScript"] as const) {
		if (typeof source[key] === "boolean") settings[key] = source[key];
		else if (source[key] !== undefined) {
			settings[key] = false;
			recovered = true;
		}
	}
	if (Object.prototype.hasOwnProperty.call(source, "views")) {
		settings.views = [];
		if (Array.isArray(source.views)) {
			const ids = new Set<string>();
			for (const view of source.views) {
				if (validView(view) && !ids.has(view.id)) {
					settings.views.push(structuredClone(view));
					ids.add(view.id);
				} else recovered = true;
			}
		} else recovered = true;
	} else if (recovered) settings.views = [];
	// Retained by subsequent ordinary saves; loading itself never overwrites the source file.
	if (recovered) settings.recoveryData = structuredClone(data);
	return { settings, recovered };
}
