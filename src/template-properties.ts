import type { TemplateVariable } from "./editor";

export function inferTemplatePropertyType(value: unknown): TemplateVariable["type"] {
	if (value === null || value === undefined) return "unknown";
	if (Array.isArray(value)) return "list";
	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "checkbox";
	if (typeof value === "string") {
		if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
		if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return "datetime";
	}
	return "text";
}
