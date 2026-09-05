import type { BasesFilter } from "./native-filters/api";

export type FilterOperator =
	| "=" | "≠" | "<" | "≤" | ">" | "≥"
	| "contains" | "does not contain"
	| "contains any of" | "does not contain any of"
	| "contains all of" | "does not contain all of"
	| "is" | "is not"
	| "is exactly" | "is not exactly"
	| "starts with" | "does not start with"
	| "ends with" | "does not end with"
	| "is empty" | "is not empty"
	| "links to" | "does not link to"
	| "in folder" | "is not in folder"
	| "has tag" | "does not have tag"
	| "has property" | "does not have property"
	| "on" | "not on"
	| "before" | "on or before"
	| "after" | "on or after";

export type FilterConjunction = "AND" | "OR" | "NOR";
export interface Filter {
	type: "filter";
	field: string;
	operator: FilterOperator;
	value?: string;
}

export interface FilterGroup {
	type: "group";
	operator: FilterConjunction;
	conditions: (Filter | FilterGroup)[];
}

export interface ViewConfig {
	id: string;
	name: string;
	rules: FilterGroup;
	/** Native Bases filters. Undefined keeps legacy rule evaluation; null matches every note. */
	basesFilters?: BasesFilter | null;
	template: string;
	/** Optional CSS for the view (injected via <style> tag) */
	css?: string;
	/** Optional JavaScript for the view (executed after render) */
	js?: string;
	/** When true, show the properties/metadata section in editing view */
	showProperties?: boolean;
	/** When true, show the inline title in editing view */
	showInlineTitle?: boolean;
	/** Show the pane navigation bar in custom reading and live preview views (default true). */
	showNavigationBar?: boolean;
}
