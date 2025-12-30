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
	const contentPlaceholderId = `custom-view-content-${Date.now()}`;

	const resolveValue = (key: string, index?: string): string | number | boolean | string[] | null => {
		let value: string | number | boolean | string[] | undefined;
		if (key === "name") value = file.name;
		else if (key === "basename") value = file.basename;
		else if (key === "size") value = file.stat.size;
		else if (key === "ctime") value = file.stat.ctime; // Timestamp for dates
		else if (key === "mtime") value = file.stat.mtime;
		else if (frontmatter && frontmatter[key] !== undefined) {
			const frontmatterValue = frontmatter[key] as string | number | boolean | string[] | undefined;
			value = frontmatterValue;
		}
		else return null;

		if (index !== undefined && Array.isArray(value)) {
			const i = parseInt(index);
			return i < value.length ? value[i] : "";
		}
		return value ?? null;
	};

	const regex = /\{\{file\.([a-zA-Z0-9_.-]+)(\[(\d+)\])?(?:\s*\|(.*?))?\}\}/g;

	const filledTemplate = template.replace(
		regex,
		(_match: string, key: string, _bracket: string | undefined, index: string | undefined, filterChain: string | undefined, offset: number, fullString: string) => {

			if (key === "content") {
				return `<div id="${contentPlaceholderId}" class="markdown-rendered-content"></div>`;
			}

			let value = resolveValue(key, index);
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
				const placeholderId = `cv-md-${markdownQueue.length}-${Date.now()}`;
				markdownQueue.push({ id: placeholderId, content: String(value) });
				return `<span id="${placeholderId}"></span>`;
			}
		}
	);

	// Use a temporary container to safely parse HTML instead of direct innerHTML
	const tempContainer = document.createElement('div');
	// eslint-disable-next-line @microsoft/sdl/no-inner-html
	tempContainer.innerHTML = filledTemplate;

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
		const sizer = document.createElement("div");
		sizer.addClass("markdown-preview-sizer");
		sizer.addClass("markdown-preview-section");
		contentEl.appendChild(sizer);

		await MarkdownRenderer.render(app, bodyContent, sizer, file.path, component);
		contentEl.removeAttribute("id");
	}

	executeScripts(container);
}

/**
 * Executes all script tags found in the container.
 * @param container - The container to execute scripts in
 */
function executeScripts(container: HTMLElement): void {
	const scripts = Array.from(container.querySelectorAll('script'));

	scripts.forEach((oldScript) => {
		const newScript = document.createElement('script');

		Array.from(oldScript.attributes).forEach((attr) => {
			newScript.setAttribute(attr.name, attr.value);
		});

		if (oldScript.textContent) {
			const scriptContent = oldScript.textContent.trim();
			if (scriptContent) {
				newScript.textContent = `(function() {\n${scriptContent}\n})();`;
			}
		}

		if (oldScript.src && !oldScript.textContent) {
			newScript.src = oldScript.src;
		}

		oldScript.parentNode?.insertBefore(newScript, oldScript);
		oldScript.remove();
	});
}
