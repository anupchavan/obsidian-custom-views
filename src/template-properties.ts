import type { App } from "obsidian";
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


const widgetTypes = new Map<string, TemplateVariable["type"]>([
	["text", "text"], ["number", "number"], ["date", "date"], ["datetime", "datetime"],
	["checkbox", "checkbox"], ["tags", "list"], ["aliases", "list"], ["multitext", "list"],
]);

/** Obsidian maintains this registry as metadata changes; older hosts use the scan fallback. */
export function getVaultTemplateProperties(app: App): TemplateVariable[] {
	const manager = (app as App & { metadataTypeManager?: {
		getAllProperties?(): Record<string, { name: string; widget?: string }>;
		getAssignedWidget?(name: string): string | null;
	} }).metadataTypeManager;
	const properties = new Map<string, TemplateVariable["type"]>();
	if (manager?.getAllProperties) {
		for (const property of Object.values(manager.getAllProperties())) {
			if (property.name !== "position") properties.set(property.name, widgetTypes.get(property.widget ?? "") ?? "unknown");
		}
	} else {
		for (const file of app.vault.getMarkdownFiles()) {
			for (const [name, value] of Object.entries(app.metadataCache.getFileCache(file)?.frontmatter ?? {})) {
				if (name === "position" || (properties.has(name) && properties.get(name) !== "unknown")) continue;
				const assigned = manager?.getAssignedWidget?.(name);
				properties.set(name, widgetTypes.get(assigned ?? "") ?? inferTemplatePropertyType(value));
			}
		}
	}
	return [...properties].sort(([a], [b]) => a.localeCompare(b)).map(([name, type]) => ({ name, type }));
}
