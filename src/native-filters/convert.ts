import type { App } from "obsidian";
import type { Filter, FilterGroup } from "../types";
import type { BasesFilter } from "./api";

/** Translate legacy filter data only when editing; never overwrite it on load. */
export function toBasesFilter(app: App, group: FilterGroup): BasesFilter | null {
	if (!group.conditions.length) return null;
	const filters = group.conditions.map(item => item.type === "group" ? toBasesFilter(app, item) ?? "true" : convertFilter(app, item));
	switch (group.operator) {
		case "AND": return { and: filters };
		case "OR": return { or: filters };
		case "NOR": return { not: filters };
	}
}

function literal(value: string): string {
	const link = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(value);
	return link ? `link(${JSON.stringify(link[1])})` : JSON.stringify(value);
}

function convertFilter(app: App, filter: Filter): string {
	const aliases = new Map([
		["file.name", "file.fullname"], ["file.extension", "file.ext"],
		["file links", "file.links"], ["file tags", "file.tags"],
	]);
	const field = aliases.get(filter.field) ?? (filter.field === "file" || filter.field.startsWith("file.") ? filter.field : `note[${JSON.stringify(filter.field)}]`);
	const value = filter.value ?? "";
	const manager = (app as App & { metadataTypeManager?: {
		getAssignedWidget?(name: string): string | null;
		getAllProperties?(): Record<string, { name: string; widget?: string }>;
	} }).metadataTypeManager;
	const type = manager?.getAssignedWidget?.(filter.field) ??
		Object.values(manager?.getAllProperties?.() ?? {}).find(property => property.name.toLowerCase() === filter.field.toLowerCase())?.widget;
	const rhs = type === "checkbox" && /^(true|false)$/.test(value) ? value : literal(value);
	const values = value.split(",").map(v => v.trim()).filter(Boolean).map(literal).join(", ");
	const call = (method: string, args = rhs) => `${field}.${method}(${args})`;
	switch (filter.operator) {
		case "=": case "≠": case "<": case "≤": case ">": case "≥": {
			const op = { "=": "==", "≠": "!=", "<": "<", "≤": "<=", ">": ">", "≥": ">=" }[filter.operator];
			if (!value.trim() || !Number.isFinite(Number(value))) return "false";
			const number = String(Number(value));
			// Bases does not accept exponent notation in a numeric literal.
			const numericRhs = /e/i.test(number) ? `number(${JSON.stringify(number)})` : number;
			return `${field} != null && !${field}.isType("boolean") && !${field}.isType("list") && ${field}.toString().trim() != "" && ${field} > -number("Infinity") && ${field} < number("Infinity") && ${field} ${op} ${numericRhs}`;
		}
		case "is": case "is not": {
			const text = JSON.stringify(value);
			const scalar = type === "checkbox" && /^(true|false)$/.test(value) ? `${field} == ${rhs}` : `${field}.toString() == ${text}`;
			const match = `if(${field}.isType("list"), ${field}.map(value.toString()).contains(${text}), if(${field} == null, ${value === ""}, ${scalar}))`;
			return filter.operator === "is not" ? `!(${match})` : match;
		}
		case "is exactly": case "is not exactly": {
			// Legacy exact lists compare string values as a multiset, including duplicates.
			const exactValues = value.split(",").map(v => v.trim()).filter(Boolean).map(v => JSON.stringify(v)).join(", ");
			const op = filter.operator === "is exactly" ? "==" : "!=";
			return `if(${field}.isType("list"), ${field}.map(value.toString()).sort() ${op} [${exactValues}].sort(), false)`;
		}
		case "is empty": case "is not empty": {
			const match = `if(${field}.isType("list"), ${field}.length == 0, ${field} == null || ${field}.toString() == "")`;
			return filter.operator === "is not empty" ? `!(${match})` : match;
		}
		case "contains": case "does not contain":
		case "contains any of": case "does not contain any of":
		case "contains all of": case "does not contain all of": {
			const single = filter.operator === "contains" || filter.operator === "does not contain";
			const terms = single ? [value] : value.split(",").map(v => v.trim()).filter(Boolean);
			const checks = terms.map(term => {
				if (term === "") return `if(${field}.isType("list"), ${field}.length > 0, true)`;
				// Native contains() ignores case; literal split preserves legacy case sensitivity.
				const text = JSON.stringify(term);
				return `if(${field}.isType("list"), ${field}.filter(value.toString().split(${text}).length > 1).length > 0, ${field}.toString().split(${text}).length > 1)`;
			});
			const match = checks.length ? checks.join(filter.operator.endsWith("all of") ? " && " : " || ") : "false";
			return filter.operator.startsWith("does not") ? `!(${match})` : match;
		}
		case "starts with": case "does not start with":
		case "ends with": case "does not end with": {
			const scalar = `if(${field} == null, "", ${field}.toString())`;
			const slice = filter.operator.endsWith("start with") || filter.operator === "starts with" ? `0, ${value.length}` : `${-value.length}`;
			const match = value === "" ? "true" : `${scalar}.slice(${slice}) == ${JSON.stringify(value)}`;
			const result = filter.operator.startsWith("does not") ? `!(${match})` : match;
			// Legacy prefix/suffix operators do not match lists, even when negated.
			return `if(${field}.isType("list"), false, ${result})`;
		}
		case "links to": return call("hasLink");
		case "does not link to": return "!" + call("hasLink");
		case "in folder": return call("inFolder");
		case "is not in folder": return "!" + call("inFolder");
		case "has tag": return call("hasTag", values);
		case "does not have tag": return "!" + call("hasTag", values);
		case "has property": return call("hasProperty");
		case "does not have property": return "!" + call("hasProperty");
		case "on": case "not on": case "before": case "on or before": case "after": case "on or after": {
			const op = { "on": "==", "not on": "!=", "before": "<", "on or before": "<=", "after": ">", "on or after": ">=" }[filter.operator];
			return `date(${field}).date() ${op} date(${JSON.stringify(value.split("T")[0])})`;
		}
	}
}
