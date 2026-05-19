export type FilterOperator =
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
	template: string;
	/** When true, hide the properties/metadata section in this view */
	showProperties?: boolean;
	/** When true, hide the inline title in this view */
	showInlineTitle?: boolean;
}
