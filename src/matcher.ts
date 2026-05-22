import { App, TFile, FrontMatterCache } from "obsidian";
import { FilterGroup, Filter } from "./types";

/** Regex for extracting [[wikilink]] targets from strings */
const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g;

/**
 * Extracts wiki-link targets from a frontmatter value (string, array, or nested).
 * Returns raw link targets (e.g. "Target" from "[[Target|Alias]]").
 */
function extractFrontmatterLinks(value: string | number | boolean | string[] | undefined): string[] {
	if (value === undefined || value === null) return [];
	if (Array.isArray(value)) return value.flatMap(item => extractFrontmatterLinks(item));
	const strValue = String(value);
	const results: string[] = [];
	let match;
	while ((match = WIKILINK_PATTERN.exec(strValue)) !== null) {
		// Handle [[Target|Alias]] → use Target
		results.push(match[1].split("|")[0]);
	}
	return results;
}

/**
 * Collects all tag names (without # prefix) from a file's body and frontmatter.
 */
function getFileTags(app: App, file: TFile, frontmatter?: FrontMatterCache): string[] {
	const cache = app.metadataCache.getFileCache(file);
	const bodyTags = (cache?.tags || []).map(t => t.tag.replace(/^#/, ""));

	const fmTags = frontmatter?.tags as string | string[] | undefined;
	if (!fmTags) return bodyTags;

	const rawTags = Array.isArray(fmTags) ? fmTags : [fmTags];
	const fmTagNames = rawTags.map(t => String(t).replace(/^#/, ""));

	return [...bodyTags, ...fmTagNames];
}

/**
 * Evaluates the rules for a given filter group, file, and frontmatter
 * @param app - The Obsidian app instance
 * @param group - The filter group to evaluate
 * @param file - The file to evaluate the rules for
 * @param frontmatter - The frontmatter of the file
 * @returns True if all conditions in the group are met, false otherwise
 */
export function checkRules(app: App, group: FilterGroup, file: TFile, frontmatter?: FrontMatterCache): boolean {
	if (!group || !group.conditions || group.conditions.length === 0) return true;

	// Evaluate all conditions in this group
	const results = group.conditions.map(condition => {
		if (condition.type === "group") {
			return checkRules(app, condition, file, frontmatter);
		} else {
			return evaluateFilter(app, condition, file, frontmatter);
		}
	});

	// Combine results based on AND (every) / OR (some) / NOR (none)
	if (group.operator === "AND") {
		return results.every(r => r === true);
	} else if (group.operator === "OR") {
		return results.some(r => r === true);
	} else if (group.operator === "NOR") {
		// NOR: None of the following are true (all must be false)
		return results.every(r => r === false);
	}
	return true;
}

/**
 * Evaluates a single filter for a given file and frontmatter
 * @param app - The Obsidian app instance
 * @param filter - The filter to evaluate
 * @param file - The file to evaluate the filter for
 * @param frontmatter - The frontmatter of the file
 * @returns True if the condition is met, false otherwise
 */
function evaluateFilter(app: App, filter: Filter, file: TFile, frontmatter?: FrontMatterCache): boolean {
	// Handle special "file" field operators
	if (filter.field === "file") {
		const filterValue = filter.value || "";

		switch (filter.operator) {
			case "links to":
			case "does not link to": {
				// Find the target file by path
				const targetFile = app.metadataCache.getFirstLinkpathDest(filterValue, file.path);
				if (!targetFile) {
					return filter.operator === "does not link to";
				}

				// Get all links from the current file body
				const cache = app.metadataCache.getFileCache(file);
				const links = cache?.links || [];
				const linkPaths = links.map(link => {
					const resolvedPath = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
					return resolvedPath?.path;
				}).filter(Boolean) as string[];

				// Also check frontmatter properties for links
				if (frontmatter) {
					const frontmatterRecord = frontmatter as Record<string, string | number | boolean | string[] | undefined>;
					for (const key of Object.keys(frontmatterRecord)) {
						for (const linkText of extractFrontmatterLinks(frontmatterRecord[key])) {
							const resolvedPath = app.metadataCache.getFirstLinkpathDest(linkText, file.path);
							if (resolvedPath?.path) {
								linkPaths.push(resolvedPath.path);
							}
						}
					}
				}

				const hasLink = linkPaths.includes(targetFile.path);
				return filter.operator === "links to" ? hasLink : !hasLink;
			}

			case "in folder":
			case "is not in folder": {
				const targetFolder = filterValue.trim();
				if (!targetFolder) {
					return filter.operator === "is not in folder";
				}

				// Normalize folder paths (remove leading/trailing slashes)
				const normalizedTarget = targetFolder.replace(/^\/+|\/+$/g, "");
				const fileFolder = file.parent?.path || "";
				const normalizedFileFolder = fileFolder.replace(/^\/+|\/+$/g, "");

				// Check if file is in the target folder or a subfolder
				const isInFolder = normalizedFileFolder === normalizedTarget ||
					normalizedFileFolder.startsWith(normalizedTarget + "/");
				return filter.operator === "in folder" ? isInFolder : !isInFolder;
			}

			case "has tag":
			case "does not have tag": {
				const filterTags = filterValue.trim().split(",").map(t => t.trim()).filter(t => t.length > 0);
				if (filterTags.length === 0) {
					return filter.operator === "does not have tag";
				}

				const fileTagNames = getFileTags(app, file, frontmatter);

				// Match exact tags or parent/child tags (e.g., "movies" matches "movies/action")
				const hasAnyTag = filterTags.some(filterTag =>
					fileTagNames.some(fileTag =>
						fileTag === filterTag ||
						fileTag.startsWith(filterTag + "/") ||
						filterTag.startsWith(fileTag + "/")
					)
				);

				return filter.operator === "has tag" ? hasAnyTag : !hasAnyTag;
			}

			case "has property":
			case "does not have property": {
				const propertyName = filterValue.trim();
				if (!propertyName) {
					return filter.operator === "does not have property";
				}

				// Check if property exists in frontmatter
				const hasProperty = frontmatter && propertyName in frontmatter;
				return filter.operator === "has property" ? !!hasProperty : !hasProperty;
			}

			default:
				return false;
		}
	}

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
	} else if (filter.field === "file links") {
		// Gather all resolved outgoing link paths (without .md extension)
		const cache = app.metadataCache.getFileCache(file);
		const bodyLinks = (cache?.links || []).map(link => {
			const resolved = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
			return resolved ? resolved.path.replace(/\.md$/, "") : null;
		}).filter(Boolean) as string[];

		// Also check frontmatter for wikilinks
		if (frontmatter) {
			const fmRecord = frontmatter as Record<string, string | number | boolean | string[] | undefined>;
			for (const key of Object.keys(fmRecord)) {
				for (const linkTarget of extractFrontmatterLinks(fmRecord[key])) {
					const resolved = app.metadataCache.getFirstLinkpathDest(linkTarget, file.path);
					if (resolved) bodyLinks.push(resolved.path.replace(/\.md$/, ""));
				}
			}
		}

		// Deduplicate
		targetValue = [...new Set(bodyLinks)];
	} else if (filter.field === "file tags") {
		targetValue = getFileTags(app, file, frontmatter);
	} else if (filter.field === "aliases") {
		const aliases = frontmatter?.aliases as string | string[] | undefined;
		if (aliases) {
			targetValue = Array.isArray(aliases) ? aliases.map(a => String(a)) : [String(aliases)];
		} else {
			targetValue = [];
		}
	} else if (frontmatter) {
		// Type-safe access to frontmatter field
		const frontmatterRecord = frontmatter as Record<string, string | number | boolean | string[] | undefined>;
		const fieldValue = frontmatterRecord[filter.field];
		targetValue = fieldValue !== undefined ? fieldValue : null;
	}

	if (targetValue === undefined || targetValue === null) targetValue = "";

	// Special handling for date operators on file.ctime and file.mtime
	const dateOperators = ["on", "not on", "before", "on or before", "after", "on or after", "is empty", "is not empty"];
	if ((filter.field === "file.ctime" || filter.field === "file.mtime") &&
		dateOperators.includes(filter.operator) &&
		typeof targetValue === "number") {

		// Handle empty checks
		if (filter.operator === "is empty") {
			return !targetValue || targetValue === 0;
		}
		if (filter.operator === "is not empty") {
			return !!targetValue && targetValue !== 0;
		}

		// Filter value is a date string (YYYY-MM-DD), but may have time component
		// Truncate to just the date part if it's a datetime string
		const filterDateStr = (filter.value || "").toString().split('T')[0];

		if (!filterDateStr || filterDateStr.length === 0) {
			// Empty filter value - can't compare
			return false;
		}

		// Convert timestamp to date string (YYYY-MM-DD)
		const targetDate = new Date(targetValue);
		const targetDateStr = targetDate.toISOString().split('T')[0];

		// Compare dates
		const targetDateObj = new Date(targetDateStr);
		const filterDateObj = new Date(filterDateStr);

		// Normalize to midnight for accurate date comparison
		targetDateObj.setHours(0, 0, 0, 0);
		filterDateObj.setHours(0, 0, 0, 0);

		switch (filter.operator) {
			case "on":
				return targetDateObj.getTime() === filterDateObj.getTime();
			case "not on":
				return targetDateObj.getTime() !== filterDateObj.getTime();
			case "before":
				return targetDateObj.getTime() < filterDateObj.getTime();
			case "on or before":
				return targetDateObj.getTime() <= filterDateObj.getTime();
			case "after":
				return targetDateObj.getTime() > filterDateObj.getTime();
			case "on or after":
				return targetDateObj.getTime() >= filterDateObj.getTime();
			default:
				return false;
		}
	}

	const filterValue = String(filter.value || "");

	if (Array.isArray(targetValue)) {
		const targetArray = targetValue;
		switch (filter.operator) {
			case "is empty":
				return targetArray.length === 0;
			case "is not empty":
				return targetArray.length > 0;
			case "is":
			case "is not": {
				const match = targetArray.some((v: string | number | boolean) => String(v) === filterValue);
				return filter.operator === "is" ? match : !match;
			}
			case "is exactly":
			case "is not exactly": {
				// Exact match: array must contain exactly the specified comma-separated values (order-independent)
				const filterValues = (filter.value || "").split(",").map(v => v.trim()).filter(v => v.length > 0);
				const targetStrings = targetArray.map((v: string | number | boolean) => String(v));
				const match = filterValues.length === targetStrings.length &&
					filterValues.every(fv => targetStrings.includes(fv));
				return filter.operator === "is exactly" ? match : !match;
			}
			case "contains":
			case "does not contain": {
				const match = targetArray.some((v: string | number | boolean) => String(v).includes(filterValue));
				return filter.operator === "contains" ? match : !match;
			}
			case "contains any of":
			case "does not contain any of": {
				// Parse comma-separated filter values
				const filterValues = (filter.value || "").split(",").map(v => String(v.trim())).filter(v => v.length > 0);
				if (filterValues.length === 0) return filter.operator === "does not contain any of";
				// Check if any filter value matches any target value
				const match = filterValues.some(filterVal =>
					targetArray.some((v: string | number | boolean) => String(v).includes(filterVal))
				);
				return filter.operator === "contains any of" ? match : !match;
			}
			case "contains all of":
			case "does not contain all of": {
				// Parse comma-separated filter values
				const filterValues = (filter.value || "").split(",").map(v => String(v.trim())).filter(v => v.length > 0);
				if (filterValues.length === 0) return filter.operator === "does not contain all of";
				// Check if all filter values are found in the target array
				const match = filterValues.every(filterVal =>
					targetArray.some((v: string | number | boolean) => String(v).includes(filterVal))
				);
				return filter.operator === "contains all of" ? match : !match;
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
				const match = String(targetScalar) === filterValue;
				return filter.operator === "is" ? match : !match;
			}
			case "contains":
			case "does not contain": {
				const match = String(targetScalar).includes(filterValue);
				return filter.operator === "contains" ? match : !match;
			}
			case "contains any of":
			case "does not contain any of": {
				// Parse comma-separated filter values
				const filterValues = (filter.value || "").split(",").map(v => String(v.trim())).filter(v => v.length > 0);
				if (filterValues.length === 0) return filter.operator === "does not contain any of";
				// Check if any filter value is contained in the target string
				const match = filterValues.some(filterVal => String(targetScalar).includes(filterVal));
				return filter.operator === "contains any of" ? match : !match;
			}
			case "contains all of":
			case "does not contain all of": {
				// Parse comma-separated filter values
				const filterValues = (filter.value || "").split(",").map(v => String(v.trim())).filter(v => v.length > 0);
				if (filterValues.length === 0) return filter.operator === "does not contain all of";
				// Check if all filter values are contained in the target string
				const match = filterValues.every(filterVal => String(targetScalar).includes(filterVal));
				return filter.operator === "contains all of" ? match : !match;
			}
			case "starts with":
			case "does not start with": {
				const match = String(targetScalar).startsWith(filterValue);
				return filter.operator === "starts with" ? match : !match;
			}
			case "ends with":
			case "does not end with": {
				const match = String(targetScalar).endsWith(filterValue);
				return filter.operator === "ends with" ? match : !match;
			}
			default:
				return false;
		}
	}
}
