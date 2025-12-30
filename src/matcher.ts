// src/matcher.ts
import { TFile, FrontMatterCache } from "obsidian";
import { FilterGroup, Filter } from "./types";

/**
 * Evaluates the rules for a given filter group, file, and frontmatter
 * @param group - The filter group to evaluate
 * @param file - The file to evaluate the rules for
 * @param frontmatter - The frontmatter of the file
 * @returns True if all conditions in the group are met, false otherwise
 */
export function checkRules(group: FilterGroup, file: TFile, frontmatter?: FrontMatterCache): boolean {
	if (!group || !group.conditions || group.conditions.length === 0) return true;

	// Evaluate all conditions in this group
	const results = group.conditions.map(condition => {
		if (condition.type === "group") {
			return checkRules(condition, file, frontmatter);
		} else {
			return evaluateFilter(condition, file, frontmatter);
		}
	});

	// Combine results based on AND (every) / OR (some)
	if (group.operator === "AND") {
		return results.every(r => r === true);
	} else {
		return results.some(r => r === true);
	}
}

/**
 * Evaluates a single filter for a given file and frontmatter
 * @param filter - The filter to evaluate
 * @param file - The file to evaluate the filter for
 * @param frontmatter - The frontmatter of the file
 * @returns True if the condition is met, false otherwise
 */
function evaluateFilter(filter: Filter, file: TFile, frontmatter?: FrontMatterCache): boolean {
	let targetValue: string | number | boolean | string[] | null = null;

	if (filter.field.startsWith("file.")) {
		if (filter.field === "file.name") targetValue = file.name;
		else if (filter.field === "file.basename") targetValue = file.basename;
		else if (filter.field === "file.path") targetValue = file.path;
		else if (filter.field === "file.folder") targetValue = file.parent?.path || "";
		else if (filter.field === "file.size") targetValue = file.stat.size;
		else if (filter.field === "file.ctime") targetValue = file.stat.ctime;
		else if (filter.field === "file.mtime") targetValue = file.stat.mtime;
		else if (filter.field === "file.extension") targetValue = file.extension;
	} else if (frontmatter) {
		// Type-safe access to frontmatter field
		const frontmatterRecord = frontmatter as Record<string, string | number | boolean | string[] | undefined>;
		const fieldValue = frontmatterRecord[filter.field];
		targetValue = fieldValue !== undefined ? fieldValue : null;
	}

	if (targetValue === undefined || targetValue === null) targetValue = "";

	const normalize = (val: string | number | boolean | string[]) => String(val).toLowerCase();
	const filterValue = normalize(filter.value || "");

	if (Array.isArray(targetValue)) {
		const targetArray = targetValue;
		switch (filter.operator) {
			case "is empty":
				return targetArray.length === 0;
			case "is not empty":
				return targetArray.length > 0;
			case "is":
			case "is not": {
				const match = targetArray.some((v: string | number | boolean) => normalize(v) === filterValue);
				return filter.operator === "is" ? match : !match;
			}
			case "contains":
			case "does not contain": {
				const match = targetArray.some((v: string | number | boolean) => normalize(v).includes(filterValue));
				return filter.operator === "contains" ? match : !match;
			}
			case "starts with":
			case "ends with":
				return false;
			default:
				return false;
		}
	} else {
		const targetScalar = targetValue;
		switch (filter.operator) {
			case "is empty":
				return !targetScalar;
			case "is not empty":
				return !!targetScalar;
			case "is":
			case "is not": {
				const match = normalize(targetScalar) === filterValue;
				return filter.operator === "is" ? match : !match;
			}
			case "contains":
			case "does not contain": {
				const match = normalize(targetScalar).includes(filterValue);
				return filter.operator === "contains" ? match : !match;
			}
			case "starts with":
				return normalize(targetScalar).startsWith(filterValue);
			case "ends with":
				return normalize(targetScalar).endsWith(filterValue);
			default:
				return false;
		}
	}
}
