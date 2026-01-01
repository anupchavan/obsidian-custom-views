import { App, TFile, FrontMatterCache } from "obsidian";
import { FilterGroup, Filter } from "./types";

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

	// Combine results based on AND (every) / OR (some)
	if (group.operator === "AND") {
		return results.every(r => r === true);
	} else {
		return results.some(r => r === true);
	}
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

					// Extract links from frontmatter values
					const extractLinks = (value: string | number | boolean | string[] | undefined): string[] => {
						if (value === undefined || value === null) return [];

						// Handle arrays (like categories: ["[[Books]]", "songs"])
						if (Array.isArray(value)) {
							return value.flatMap(item => extractLinks(item));
						}

						// Convert to string and extract [[...]] patterns
						const strValue = String(value);
						const linkPattern = /\[\[([^\]]+)\]\]/g;
						const matches: string[] = [];
						let match;

						while ((match = linkPattern.exec(strValue)) !== null) {
							matches.push(match[1]);
						}

						return matches;
					};

					// Check all frontmatter properties for links
					for (const key of Object.keys(frontmatterRecord)) {
						const value = frontmatterRecord[key];
						const extractedLinks = extractLinks(value);

						// Resolve each extracted link
						for (const linkText of extractedLinks) {
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
				const trimmedValue = filterValue.trim();
				const filterTags = trimmedValue.split(",").map(t => t.trim()).filter(t => t.length > 0);
				if (filterTags.length === 0) {
					return filter.operator === "does not have tag";
				}

				const cache = app.metadataCache.getFileCache(file);

				// Get tags from both cache.tags (body tags) and frontmatter.tags (frontmatter tags)
				const bodyTags = cache?.tags || [];
				const frontmatterTags = frontmatter?.tags as string | string[] | undefined;

				// Combine tags from both sources
				// For frontmatter tags, we'll just extract the tag strings and compare them separately
				const fileTags = [...bodyTags];
				const frontmatterTagStrings: string[] = [];
				if (frontmatterTags) {
					// If frontmatter has tags as an array, extract tag strings
					if (Array.isArray(frontmatterTags)) {
						frontmatterTagStrings.push(...frontmatterTags.map(tag =>
							typeof tag === 'string' ? (tag.startsWith('#') ? tag : `#${tag}`) : String(tag)
						));
					} else if (typeof frontmatterTags === 'string') {
						// Single tag as string
						frontmatterTagStrings.push(frontmatterTags.startsWith('#') ? frontmatterTags : `#${frontmatterTags}`);
					}
				}

				// Normalize file tags: remove # prefix (preserve case)
				// Include both body tags and frontmatter tags
				const fileTagNames = [
					...fileTags.map(tag => {
						// tag.tag is the full tag string like "#movies" or "#movies/action"
						return tag.tag.replace(/^#+/, "");
					}),
					...frontmatterTagStrings.map(tag => {
						return tag.replace(/^#+/, "");
					})
				];

				// Check if any of the filter tags match any file tag
				// Match exact tags or parent tags (e.g., "movies" matches "#movies" and "#movies/action")
				const hasAnyTag = filterTags.some(filterTag => {
					return fileTagNames.some(fileTag => {
						// Exact match
						if (fileTag === filterTag) return true;
						// Parent tag match (e.g., fileTag is "movies/action" and filterTag is "movies")
						if (fileTag.startsWith(filterTag + "/")) return true;
						// Child tag match (e.g., fileTag is "movies" and filterTag is "movies/action")
						if (filterTag.startsWith(fileTag + "/")) return true;
						return false;
					});
				});

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
	} else if (filter.field === "file tags") {
		// Special handling for file tags - get from Obsidian's metadata cache
		const cache = app.metadataCache.getFileCache(file);
		const bodyTags = cache?.tags || [];
		const frontmatterTags = frontmatter?.tags as string | string[] | undefined;

		// Get tag strings from body tags
		const bodyTagStrings = bodyTags.map(tag => tag.tag.replace(/^#+/, ""));

		// Get tag strings from frontmatter tags
		const frontmatterTagStrings: string[] = [];
		if (frontmatterTags) {
			if (Array.isArray(frontmatterTags)) {
				frontmatterTagStrings.push(...frontmatterTags.map(tag =>
					typeof tag === 'string' ? tag.replace(/^#+/, "") : String(tag).replace(/^#+/, "")
				));
			} else if (typeof frontmatterTags === 'string') {
				frontmatterTagStrings.push(frontmatterTags.replace(/^#+/, ""));
			}
		}

		// Combine tags from both sources
		targetValue = [...bodyTagStrings, ...frontmatterTagStrings];
	} else if (filter.field === "aliases") {
		// Special handling for aliases - get from both frontmatter and metadata cache
		const cache = app.metadataCache.getFileCache(file);
		const frontmatterAliases = frontmatter?.aliases as string | string[] | undefined;
		const cacheAliases = cache?.frontmatter?.aliases as string | string[] | undefined;

		const aliasList: string[] = [];

		// Get aliases from frontmatter
		if (frontmatterAliases) {
			if (Array.isArray(frontmatterAliases)) {
				aliasList.push(...frontmatterAliases.map(alias => String(alias)));
			} else if (typeof frontmatterAliases === 'string') {
				aliasList.push(frontmatterAliases);
			}
		}

		// Get aliases from cache (if different from frontmatter)
		if (cacheAliases && cacheAliases !== frontmatterAliases) {
			if (Array.isArray(cacheAliases)) {
				aliasList.push(...cacheAliases.map(alias => String(alias)));
			} else if (typeof cacheAliases === 'string') {
				aliasList.push(cacheAliases);
			}
		}

		targetValue = aliasList;
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

	// Convert to string preserving case (case-sensitive matching)
	const toString = (val: string | number | boolean | string[]) => String(val);
	const filterValue = toString(filter.value || "");

	if (Array.isArray(targetValue)) {
		const targetArray = targetValue;
		switch (filter.operator) {
			case "is empty":
				return targetArray.length === 0;
			case "is not empty":
				return targetArray.length > 0;
			case "is":
			case "is not": {
				const match = targetArray.some((v: string | number | boolean) => toString(v) === filterValue);
				return filter.operator === "is" ? match : !match;
			}
			case "contains":
			case "does not contain": {
				const match = targetArray.some((v: string | number | boolean) => toString(v).includes(filterValue));
				return filter.operator === "contains" ? match : !match;
			}
			case "contains any of":
			case "does not contain any of": {
				// Parse comma-separated filter values
				const filterValues = (filter.value || "").split(",").map(v => toString(v.trim())).filter(v => v.length > 0);
				if (filterValues.length === 0) return filter.operator === "does not contain any of";
				// Check if any filter value matches any target value
				const match = filterValues.some(filterVal =>
					targetArray.some((v: string | number | boolean) => toString(v).includes(filterVal))
				);
				return filter.operator === "contains any of" ? match : !match;
			}
			case "contains all of":
			case "does not contain all of": {
				// Parse comma-separated filter values
				const filterValues = (filter.value || "").split(",").map(v => toString(v.trim())).filter(v => v.length > 0);
				if (filterValues.length === 0) return filter.operator === "does not contain all of";
				// Check if all filter values are found in the target array
				const match = filterValues.every(filterVal =>
					targetArray.some((v: string | number | boolean) => toString(v).includes(filterVal))
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
				const match = toString(targetScalar) === filterValue;
				return filter.operator === "is" ? match : !match;
			}
			case "contains":
			case "does not contain": {
				const match = toString(targetScalar).includes(filterValue);
				return filter.operator === "contains" ? match : !match;
			}
			case "contains any of":
			case "does not contain any of": {
				// Parse comma-separated filter values
				const filterValues = (filter.value || "").split(",").map(v => toString(v.trim())).filter(v => v.length > 0);
				if (filterValues.length === 0) return filter.operator === "does not contain any of";
				// Check if any filter value is contained in the target string
				const match = filterValues.some(filterVal => toString(targetScalar).includes(filterVal));
				return filter.operator === "contains any of" ? match : !match;
			}
			case "contains all of":
			case "does not contain all of": {
				// Parse comma-separated filter values
				const filterValues = (filter.value || "").split(",").map(v => toString(v.trim())).filter(v => v.length > 0);
				if (filterValues.length === 0) return filter.operator === "does not contain all of";
				// Check if all filter values are contained in the target string
				const match = filterValues.every(filterVal => toString(targetScalar).includes(filterVal));
				return filter.operator === "contains all of" ? match : !match;
			}
			case "starts with":
				return toString(targetScalar).startsWith(filterValue);
			case "ends with":
				return toString(targetScalar).endsWith(filterValue);
			default:
				return false;
		}
	}
}
