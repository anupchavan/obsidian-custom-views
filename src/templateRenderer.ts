import { App, TFile, MarkdownRenderer, Component } from "obsidian";
import { applyFilterChain } from "./filters";

/**
 * Renders a template into a container.
 * @param app - The Obsidian app instance
 * @param template - The template to render
 * @param file - The file to render the template for
 * @param container - The container to render the template into
 * @param component - The component to render the template with
 */
export async function renderTemplate(
	app: App,
	template: string,
	file: TFile,
	container: HTMLElement,
	component: Component
) {
	const cache = app.metadataCache.getFileCache(file);
	const frontmatter = cache?.frontmatter;
	const rawContent = await app.vault.read(file);

	let bodyContent = rawContent;
	if (frontmatter && frontmatter.position) {
		const position = frontmatter.position as { start?: { offset: number }, end?: { offset: number } };
		if (position.end && typeof position.end === 'object' && position.end !== null && 'offset' in position.end) {
			const endOffset = position.end.offset;
			bodyContent = rawContent.substring(endOffset).trim();
		}
	}

	const markdownQueue: { id: string, content: string }[] = [];
	const contentPlaceholderId = `custom-rule-content-${Date.now()}`;

	const resolveValue = (key: string, index?: string, isFileProperty: boolean = false): string | number | boolean | string[] | null => {
		let value: string | number | boolean | string[] | undefined;

		// Handle file properties (only when using file. prefix)
		if (isFileProperty) {
			if (key === "name") value = file.name;
			else if (key === "basename") value = file.basename;
			else if (key === "path") value = file.path;
			else if (key === "folder") value = file.parent?.path || "";
			else if (key === "extension") value = file.extension;
			else if (key === "size") value = file.stat.size;
			else if (key === "ctime") value = file.stat.ctime; // Timestamp for dates
			else if (key === "mtime") value = file.stat.mtime;
			else if (key === "content") {
				// Special case: content is handled separately
				return null;
			}
		}

		// Check frontmatter (works for both file.property and property syntax)
		if (frontmatter && frontmatter[key] !== undefined) {
			const frontmatterValue = frontmatter[key] as string | number | boolean | string[] | undefined;
			value = frontmatterValue;
		}

		// If not found and not a file property, return null
		if (value === undefined) return null;

		if (index !== undefined && Array.isArray(value)) {
			const i = parseInt(index);
			return i < value.length ? (value[i] ?? null) : "";
		}
		return value ?? null;
	};

	// Match both {{file.property}} and {{property}} patterns
	const regex = /\{\{(file\.)?([a-zA-Z0-9_.-]+)(\[(\d+)\])?(?:\s*\|(.*?))?\}\}/g;

	const filledTemplate = template.replace(
		regex,
		(_match: string, filePrefix: string | undefined, key: string, _bracket: string | undefined, index: string | undefined, filterChain: string | undefined, offset: number, fullString: string) => {
			// Determine if this is a file.property pattern
			const isFileProperty = filePrefix === 'file.';

			if (key === "content") {
				return `<div id="${contentPlaceholderId}" class="markdown-rendered-content"></div>`;
			}

			let value = resolveValue(key, index, isFileProperty);
			if (value === null) return "";

			if (filterChain) {
				const filteredValue = applyFilterChain(value, filterChain.trim());
				// Convert FilterValue to the expected return type
				if (filteredValue === null || filteredValue === undefined) return "";
				if (Array.isArray(filteredValue) && filteredValue.length > 0 && typeof filteredValue[0] === 'number') {
					// Convert number[] to string[] for consistency
					const numArray = filteredValue as number[];
					value = numArray.map((v: number) => String(v));
				} else {
					value = filteredValue as string | number | boolean | string[] | null;
				}
				if (value === null) return "";
			}

			const prefix = fullString.substring(0, offset);
			const doubleQuotesMatch = prefix.match(/"/g);
			const singleQuotesMatch = prefix.match(/'/g);
			const doubleQuotes = doubleQuotesMatch ? doubleQuotesMatch.length : 0;
			const singleQuotes = singleQuotesMatch ? singleQuotesMatch.length : 0;
			const isInsideAttribute = (doubleQuotes % 2 !== 0) || (singleQuotes % 2 !== 0);

			if (isInsideAttribute) {
				return String(value);
			} else {
				const placeholderId = `ore-md-${markdownQueue.length}-${Date.now()}`;
				markdownQueue.push({ id: placeholderId, content: String(value) });
				return `<span id="${placeholderId}"></span>`;
			}
		}
	);


	// Use DOMParser to safely parse HTML instead of innerHTML
	const parser = new DOMParser();
	const doc = parser.parseFromString(filledTemplate, 'text/html');
	const tempContainer = doc.body;

	// Clear the container and move nodes from temporary container
	while (container.firstChild) {
		container.removeChild(container.firstChild);
	}
	while (tempContainer.firstChild) {
		container.appendChild(tempContainer.firstChild);
	}

	for (const item of markdownQueue) {
		const span = container.querySelector(`#${item.id}`) as HTMLElement;
		if (span) {
			await MarkdownRenderer.render(app, item.content, span, file.path, component);
			span.removeAttribute("id");

			const p = span.querySelector("p");
			if (p && p.parentElement === span && span.children.length === 1) {
				p.replaceWith(...Array.from(p.childNodes));
			}
		}
	}

	const contentEl = container.querySelector(`#${contentPlaceholderId}`) as HTMLElement;
	if (contentEl) {
		const sizer = activeDocument.createElement("div");
		sizer.addClass("markdown-preview-sizer");
		sizer.addClass("markdown-preview-section");
		contentEl.appendChild(sizer);

		await MarkdownRenderer.render(app, bodyContent, sizer, file.path, component);
		contentEl.removeAttribute("id");
	}

	executeScripts(container);
}

/**
 * Executes inline script tags found in the container.
 *
 * Scripts with a `src` attribute are intentionally ignored — loading external
 * scripts would allow arbitrary remote code execution, which violates
 * Obsidian's plugin guidelines.  Only inline script content (written by the
 * user directly in their template) is evaluated, using the Function constructor
 * rather than dynamic `<script>` element injection so that no external URLs
 * can be loaded.
 *
 * @param container - The container whose inline scripts should be executed
 */
function executeScripts(container: HTMLElement): void {
	const scripts = Array.from(container.querySelectorAll('script'));

	scripts.forEach((script) => {
		// Silently drop src-based scripts — external code must never be loaded.
		if (!script.src) {
			const code = script.textContent?.trim();
			if (code) {
				try {
					// The Function constructor creates a new function in the
					// global scope (same as an inline script would) without
					// injecting a DOM <script> element.  `this` is bound to
					// the container so template scripts can reference it.
					// eslint-disable-next-line @typescript-eslint/no-implied-eval
					const fn = new Function(code);
					fn.call(container);
				} catch (e) {
					console.error('[Custom Views] Error executing template script:', e);
				}
			}
		}
		script.remove();
	});
}
