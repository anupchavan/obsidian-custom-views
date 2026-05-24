import { App, TFile, MarkdownRenderer, Component } from "obsidian";
import { applyFilterChain } from "./filters";
import { isExpressionMode, evaluateExpression, processLogicBlocks } from "./expression";
import type { ExprContext } from "./expression";
import type { ViewConfig } from "./types";

// ---------------------------------------------------------------------------
// Cross-file property resolution helpers
// ---------------------------------------------------------------------------

/** A single segment in a property chain like `cast[0].cover[1]` */
interface PropertySegment {
	key: string;
	index?: number; // array index, if present
}

/**
 * Parse a property path like `cast[0].cover[1]` into segments.
 * Each segment has a `key` and an optional numeric `index`.
 */
export function parsePropertyPath(path: string): PropertySegment[] {
	const segments: PropertySegment[] = [];
	// Split on dots, then extract optional [N] from each part
	const parts = path.split(".");
	for (const part of parts) {
		const bracketMatch = part.match(/^([a-zA-Z0-9_-]+)\[(\d+)\]$/);
		if (bracketMatch) {
			segments.push({ key: bracketMatch[1], index: parseInt(bracketMatch[2]) });
		} else if (part) {
			segments.push({ key: part });
		}
	}
	return segments;
}

/**
 * Extract a wiki-link target from a string like `[[Adarsh Gourav]]` or
 * `[[folder/Adarsh Gourav|display text]]`.
 * Returns the link target (without display alias) or null if not a wiki-link.
 */
export function extractWikiLink(value: string): string | null {
	if (typeof value !== "string") return null;
	const match = value.trim().match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
	return match ? match[1].trim() : null;
}

/**
 * Resolve a file from a wiki-link target string using Obsidian's metadata cache.
 * Handles both full paths and basename-only links.
 */
function resolveLinkedFile(app: App, linkTarget: string, sourcePath: string): TFile | null {
	// Use Obsidian's built-in link resolution which handles all link formats
	const linkedFile = app.metadataCache.getFirstLinkpathDest(linkTarget, sourcePath);
	return linkedFile;
}

/**
 * Resolve a full property chain that may cross file boundaries.
 *
 * For example, given frontmatter `{ cast: ["[[Adarsh Gourav]]", "[[Someone]]"] }`:
 *   - `cast[0].cover[0]` → resolves `cast[0]` to `[[Adarsh Gourav]]`,
 *     finds that file, reads its frontmatter `cover` property, indexes [0].
 *   - `cast[0].puchi.content` → resolves across two linked files, reading
 *     the body content of the final linked file.
 *
 * @param app - Obsidian App instance for file lookups
 * @param segments - parsed property segments
 * @param file - the current file (source of the template)
 * @param frontmatter - the current file's frontmatter
 * @param bodyContent - the current file's body content
 * @returns the resolved value, or null if resolution fails
 */
export async function resolvePropertyChain(
	app: App,
	segments: PropertySegment[],
	file: TFile,
	frontmatter: Record<string, unknown> | undefined,
	bodyContent: string
): Promise<unknown> {
	if (segments.length === 0) return null;

	let currentFrontmatter = frontmatter;
	let currentFile = file;
	let currentBodyContent = bodyContent;

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];

		// Try to resolve the key against file properties or frontmatter
		let value: unknown = undefined;

		// Check built-in file properties at every level — these work for
		// the source file and any linked file we've resolved to
		if (seg.key === "name") value = currentFile.name;
		else if (seg.key === "basename") value = currentFile.basename;
		else if (seg.key === "size") value = currentFile.stat.size;
		else if (seg.key === "ctime") value = currentFile.stat.ctime;
		else if (seg.key === "mtime") value = currentFile.stat.mtime;
		else if (seg.key === "content") value = currentBodyContent;

		// Check frontmatter (frontmatter property takes priority over builtins
		// only when explicitly defined — but builtins like "content" should
		// not be overridden by frontmatter)
		if (value === undefined && currentFrontmatter && currentFrontmatter[seg.key] !== undefined) {
			value = currentFrontmatter[seg.key];
		}

		if (value === undefined) return null;

		// Apply array index if present
		if (seg.index !== undefined) {
			if (Array.isArray(value)) {
				value = seg.index < value.length ? value[seg.index] : null;
			} else {
				return null; // tried to index a non-array
			}
		}

		if (value === null || value === undefined) return null;

		// If there are more segments, the current value must be a wiki-link
		// that we can resolve to another file
		if (i < segments.length - 1) {
			const linkTarget = extractWikiLink(typeof value === "string" ? value : "");
			if (!linkTarget) {
				// Not a wiki-link — can't chain further
				return null;
			}

			const linkedFile = resolveLinkedFile(app, linkTarget, currentFile.path);
			if (!linkedFile) return null;

			// Get the linked file's frontmatter
			const linkedCache = app.metadataCache.getFileCache(linkedFile);
			currentFrontmatter = linkedCache?.frontmatter;
			currentFile = linkedFile;

			// Read body content of the linked file so that `.content`
			// works at every level of the chain
			const rawLinked = await app.vault.cachedRead(linkedFile);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
			const linkedEndOffset = (currentFrontmatter as any)?.position?.end?.offset;
			if (typeof linkedEndOffset === "number") {
				currentBodyContent = rawLinked.substring(linkedEndOffset).trim();
			} else {
				currentBodyContent = rawLinked;
			}
		} else {
			// Last segment — return the value
			return value;
		}
	}

	return null;
}

/**
 * Checks whether a template contains an unfiltered {{file.content}} or {{content}}
 * placeholder, making it eligible for editable content mode.
 * Returns false if the content placeholder has a filter pipe (e.g. {{file.content | uppercase}})
 * or if there is no content placeholder at all.
 */
export function templateHasEditableContent(template: string): boolean {
	// Match {{ file.content }} or {{ content }} with optional filter, allowing whitespace
	const contentRegex = /\{\{\s*(?:file\.)?content\s*(?:\|.*?)?\}\}/g;
	let match;
	while ((match = contentRegex.exec(template)) !== null) {
		if (match[0].includes("|")) return false;
		return true;
	}
	return false;
}

/** Attribute added to the content placeholder div when in editable mode */
export const EDITABLE_PLACEHOLDER_ATTR = "data-cv-editable-placeholder";

/**
 * Renders a template into a container.
 * @param app - The Obsidian app instance
 * @param template - The template to render
 * @param file - The file to render the template for
 * @param container - The container to render the template into
 * @param component - The component to render the template with
 * @param editableMode - When true, the content placeholder is left empty for the editor to be reparented into
 * @param viewConfig - Optional ViewConfig for CSS/JS injection
 * @param scopeId - Optional unique ID for CSS scoping (set on the container's parent via data-cv-id)
 */
export async function renderTemplate(
	app: App,
	template: string,
	file: TFile,
	container: HTMLElement,
	component: Component,
	editableMode: boolean = false,
	viewConfig?: ViewConfig,
	scopeId?: string,
	allowJavaScript: boolean = true
) {
	const cache = app.metadataCache.getFileCache(file);
	const frontmatter = cache?.frontmatter;
	const rawContent = await app.vault.read(file);

	let bodyContent = rawContent;
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
	const endOffset = frontmatter?.position?.end?.offset;
	if (typeof endOffset === "number") {
		bodyContent = rawContent.substring(endOffset).trim();
	}

	const markdownQueue: { id: string, content: string }[] = [];
	const contentPlaceholderId = `custom-view-content-${Date.now()}`;

	// Build expression context for logic blocks and expression mode
	const exprCtx: ExprContext = {
		app,
		file,
		frontmatter,
		bodyContent,
		variables: {},
	};

	// Process Clipper-style logic blocks first: {% if %}, {% for %}, {% set %}
	let processedTemplate = template;
	if (template.includes('{%')) {
		processedTemplate = await processLogicBlocks(template, exprCtx);
	}

	const matches = collectTemplateMatches(processedTemplate);

	// Resolve all values (potentially async for cross-file chains)
	const resolvedValues: string[] = [];
	for (const match of matches) {
		const { innerExpr, offset } = match;

		// Special content placeholder
		if (innerExpr === "content" || innerExpr === "file.content") {
			resolvedValues.push(
				`<div id="${contentPlaceholderId}" class="markdown-rendered-content markdown-preview-view markdown-rendered"></div>`
			);
			continue;
		}

		const finalValue = await resolveExprValue(innerExpr, exprCtx, app, file, frontmatter, bodyContent);

		if (finalValue === null || finalValue === undefined) {
			resolvedValues.push("");
			continue;
		}

		const prefix = processedTemplate.substring(0, offset);
		const doubleQuotes = prefix.split('"').length - 1;
		const singleQuotes = prefix.split("'").length - 1;
		const isInsideAttribute = (doubleQuotes % 2 !== 0) || (singleQuotes % 2 !== 0);

		if (isInsideAttribute) {
			resolvedValues.push(resultToString(finalValue));
		} else {
			const placeholderId = `cv-md-${markdownQueue.length}-${Date.now()}`;
			markdownQueue.push({ id: placeholderId, content: resultToString(finalValue) });
			resolvedValues.push(`<span id="${placeholderId}"></span>`);
		}
	}

	const filledTemplate = applyReplacements(processedTemplate, matches, resolvedValues);

	// Use DOMParser to safely parse HTML instead of innerHTML
	const parser = new DOMParser();
	const doc = parser.parseFromString(filledTemplate, 'text/html');
	const tempContainer = doc.body;

	// Disconnect any previous CSS-scoping MutationObserver from a prior render
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
	if ((container as any).__cvScopeObserver) { (container as any).__cvScopeObserver.disconnect(); (container as any).__cvScopeObserver = null; }

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
		if (editableMode) {
			// In editable mode, leave the placeholder empty — the caller will
			// reparent the real CM6 editor into it.
			contentEl.setAttribute(EDITABLE_PLACEHOLDER_ATTR, "true");
			contentEl.removeAttribute("id");
		} else {
			const sizer = activeDocument.createElement("div");
			sizer.addClass("markdown-preview-sizer");
			sizer.addClass("markdown-preview-section");
			contentEl.appendChild(sizer);

			await MarkdownRenderer.render(app, bodyContent, sizer, file.path, component);
			contentEl.removeAttribute("id");
		}
	}

	// Inject CSS from the separate CSS field (with template resolution)
	if (viewConfig?.css) {
		const resolvedCss = await resolveTemplateRaw(app, viewConfig.css, file, frontmatter, bodyContent);
		if (resolvedCss.trim()) {
			const styleEl = activeDocument.createElement("style");
			styleEl.textContent = resolvedCss;
			container.prepend(styleEl);
		}
	}

	// Execute scripts only when JavaScript execution is allowed
	if (allowJavaScript) {
		// Execute inline scripts from the HTML template
		executeScripts(container);

		// Execute JS from the separate JS field (with template resolution)
		if (viewConfig?.js) {
			const resolvedJs = await resolveTemplateRaw(app, viewConfig.js, file, frontmatter, bodyContent);
			if (resolvedJs.trim()) {
				try {
					// eslint-disable-next-line @typescript-eslint/no-implied-eval
					const fn = new Function(resolvedJs);
					fn.call(container);
				} catch (e) {
					console.error('[Custom Views] Error executing view JS:', e);
				}
			}
		}
	}

	// Scope all <style> elements inside the container so CSS doesn't leak
	// between tabs.  The parent container has data-cv-id="<scopeId>", and
	// this element (customEl) is a child of it.  Wrapping each stylesheet's
	// content with `[data-cv-id="<scopeId>"] { … }` uses CSS nesting to
	// restrict every rule to descendants of that specific parent.
	if (scopeId) {
		scopeStyleElements(container, scopeId);

		// Watch for <style> elements injected later by async JS (e.g. after
		// an image loads) so they get scoped too.
		const observer = new MutationObserver((mutations) => {
			for (const m of mutations) {
				for (const node of Array.from(m.addedNodes)) {
					if (node.nodeType !== Node.ELEMENT_NODE) continue;
					const el = node as HTMLElement;
					if (el.tagName === "STYLE" || el.querySelector("style")) {
						scopeStyleElements(container, scopeId);
						return;
					}
				}
			}
		});
		observer.observe(container, { childList: true, subtree: true });

		// Store the observer so it can be disconnected on re-render
		// (the container is cleared at the top of renderTemplate, which
		// removes all children but the observer still watches the element).
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
		(container as any).__cvScopeObserver = observer;
	}
}

/**
 * Wrap all unscoped <style> elements inside a container with a CSS nesting
 * selector that restricts rules to a specific data-cv-id scope.
 */
function scopeStyleElements(container: HTMLElement, scopeId: string) {
	const styles = container.querySelectorAll("style");
	for (const style of Array.from(styles)) {
		const raw = style.textContent;
		if (raw && !style.hasAttribute("data-cv-scoped")) {
			style.textContent = `[data-cv-id="${scopeId}"] {\n${raw}\n}`;
			style.setAttribute("data-cv-scoped", "true");
		}
	}
}

/** Find the first pipe character outside of quotes */
export function findFirstPipe(str: string): number {
	let inQuote = false;
	let quoteChar = '';
	for (let i = 0; i < str.length; i++) {
		const ch = str[i];
		if (!inQuote && (ch === '"' || ch === "'")) {
			inQuote = true;
			quoteChar = ch;
		} else if (inQuote && ch === quoteChar) {
			inQuote = false;
		} else if (!inQuote && ch === '|') {
			return i;
		}
	}
	return -1;
}

// ---------------------------------------------------------------------------
// Shared template resolution helpers
// ---------------------------------------------------------------------------

/** Template regex for matching {{ expressions }} */
const TEMPLATE_EXPR_RE = /\{\{((?:[^{}]|\{[^{]|\}[^}])*?)\}\}/g;

/** A matched {{ expression }} in the template string */
interface TemplateMatch {
	fullMatch: string;
	innerExpr: string;
	offset: number;
}

/** Collect all {{ expression }} matches in a template string */
function collectTemplateMatches(template: string): TemplateMatch[] {
	const matches: TemplateMatch[] = [];
	let m;
	while ((m = TEMPLATE_EXPR_RE.exec(template)) !== null) {
		matches.push({ fullMatch: m[0], innerExpr: m[1].trim(), offset: m.index });
	}
	TEMPLATE_EXPR_RE.lastIndex = 0; // reset for reuse
	return matches;
}

/** Replace all matched expressions in reverse order (so offsets stay valid) */
function applyReplacements(template: string, matches: TemplateMatch[], values: string[]): string {
	let result = template;
	for (let i = matches.length - 1; i >= 0; i--) {
		const { fullMatch, offset } = matches[i];
		result = result.substring(0, offset) + values[i] + result.substring(offset + fullMatch.length);
	}
	return result;
}

/** Convert an expression/property result to a plain string */
export function resultToString(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) {
		return value.map(v => {
			if (v === null || v === undefined) return "";
			if (typeof v === "object") return JSON.stringify(v);
			return String(v);
		}).join(", ");
	}
	return JSON.stringify(value);
}

/**
 * Resolve a single template expression (expression mode or legacy pipe mode)
 * to a raw value. Returns undefined if resolution fails.
 */
async function resolveExprValue(
	innerExpr: string,
	exprCtx: ExprContext,
	app: App,
	file: TFile,
	frontmatter: Record<string, unknown> | undefined,
	bodyContent: string
): Promise<unknown> {
	if (isExpressionMode(innerExpr)) {
		return evaluateExpression(innerExpr, exprCtx);
	}

	// Legacy mode: property chain with optional pipe filters
	let chain = innerExpr;
	let filterChain: string | undefined;

	const pipeIdx = findFirstPipe(chain);
	if (pipeIdx !== -1) {
		filterChain = chain.substring(pipeIdx + 1).trim();
		chain = chain.substring(0, pipeIdx).trim();
	}

	if (chain.startsWith("file.")) {
		chain = chain.substring(5);
	}

	const segments = parsePropertyPath(chain);
	if (segments.length === 0) return null;

	const value = await resolvePropertyChain(app, segments, file, frontmatter, bodyContent);
	if (value === null || value === undefined) return null;

	if (filterChain) {
		return applyFilterChain(value as Parameters<typeof applyFilterChain>[0], filterChain);
	}

	return value;
}

/**
 * Resolves {{}} template placeholders with raw string insertion (no Markdown rendering).
 * Used for CSS and JS fields where we don't want HTML/Markdown processing.
 * Supports cross-file property chaining, expression mode, and logic blocks.
 */
async function resolveTemplateRaw(
	app: App,
	template: string,
	file: TFile,
	frontmatter: Record<string, unknown> | undefined,
	bodyContent: string
): Promise<string> {
	const exprCtx: ExprContext = { app, file, frontmatter, bodyContent, variables: {} };

	let processedTemplate = template;
	if (template.includes('{%')) {
		processedTemplate = await processLogicBlocks(template, exprCtx);
	}

	const matches = collectTemplateMatches(processedTemplate);
	if (matches.length === 0) return processedTemplate;

	const resolvedValues: string[] = [];
	for (const match of matches) {
		if (match.innerExpr === "content" || match.innerExpr === "file.content") {
			resolvedValues.push(bodyContent);
			continue;
		}
		const value = await resolveExprValue(match.innerExpr, exprCtx, app, file, frontmatter, bodyContent);
		resolvedValues.push(resultToString(value));
	}

	return applyReplacements(processedTemplate, matches, resolvedValues);
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
