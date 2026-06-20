import { App, TFile, MarkdownRenderer, Component } from "obsidian";
import { applyFilterChain } from "./filters";
import {
	isExpressionMode,
	evaluateExpression,
	processLogicBlocks,
	resolveDeferredMarkdownPlaceholder,
} from "./expression";
import type { ExprContext, ExprValueArray } from "./expression";
import { stripFrontmatter } from "./frontmatter";
import type { ViewConfig } from "./types";
import { executeCustomViewJavaScript } from "./script-engine";
import type { CustomViewScriptContext } from "./script-engine";
import { buildBasesCollection } from "./bases/access";
import { templateReferencesBases } from "./bases/code-blocks";
import { stripTemplateBaseBlocks } from "./bases/template-syntax";
import type { BasesDataProvider, TemplateBases } from "./bases/types";

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
	for (const part of splitPropertyPath(path)) {
		const segment = parsePropertySegment(part);
		if (segment) segments.push(segment);
	}
	return segments;
}

function splitPropertyPath(path: string): string[] {
	const parts: string[] = [];
	let start = 0;
	let bracketDepth = 0;
	let quote: string | null = null;

	for (let i = 0; i < path.length; i++) {
		const ch = path[i];

		if (quote) {
			if (ch === "\\") {
				i++;
			} else if (ch === quote) {
				quote = null;
			}
			continue;
		}

		if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (ch === "[") {
			bracketDepth++;
		} else if (ch === "]") {
			bracketDepth = Math.max(0, bracketDepth - 1);
		} else if (ch === "." && bracketDepth === 0) {
			parts.push(path.slice(start, i));
			start = i + 1;
		}
	}

	parts.push(path.slice(start));
	return parts;
}

function parsePropertySegment(part: string): PropertySegment | null {
	const text = part.trim();
	if (!text) return null;

	const quoted = readQuotedString(text, 0);
	if (quoted) return parsePropertySegmentTail(text, quoted.value, quoted.end);

	if (text.startsWith("[")) {
		let pos = skipWhitespace(text, 1);
		const bracketQuoted = readQuotedString(text, pos);
		if (bracketQuoted) {
			pos = skipWhitespace(text, bracketQuoted.end);
			if (text[pos] === "]") {
				return parsePropertySegmentTail(text, bracketQuoted.value, pos + 1);
			}
		}
	}

	const indexedMatch = text.match(/^(.*?)(?:\[(\d+)\])?$/);
	if (!indexedMatch || !indexedMatch[1]) return null;

	const segment: PropertySegment = { key: indexedMatch[1] };
	if (indexedMatch[2] !== undefined) {
		segment.index = parseInt(indexedMatch[2]);
	}
	return segment;
}

function parsePropertySegmentTail(text: string, key: string, offset: number): PropertySegment | null {
	if (!key) return null;
	const tail = text.slice(offset).trim();
	if (!tail) return { key };

	const indexMatch = tail.match(/^\[(\d+)\]$/);
	if (!indexMatch) return null;
	return { key, index: parseInt(indexMatch[1]) };
}

function readQuotedString(input: string, start: number): { value: string; end: number } | null {
	const quote = input[start];
	if (quote !== '"' && quote !== "'") return null;

	let value = "";
	for (let i = start + 1; i < input.length; i++) {
		const ch = input[i];
		if (ch === "\\" && i + 1 < input.length) {
			i++;
			value += input[i];
		} else if (ch === quote) {
			return { value, end: i + 1 };
		} else {
			value += ch;
		}
	}

	return null;
}

function skipWhitespace(input: string, start: number): number {
	let pos = start;
	while (pos < input.length && /\s/.test(input[pos])) pos++;
	return pos;
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
	bodyContent: string,
	bases?: TemplateBases,
): Promise<unknown> {
	if (segments.length === 0) return null;

	let currentContext: ChainContext = {
		kind: "file",
		file,
		frontmatter,
		bodyContent,
		bases,
	};
	let linkSourceFile = file;

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		let value = resolveChainSegment(currentContext, seg.key);

		if (value === undefined) return null;

		if (seg.index !== undefined) {
			value = applySegmentIndex(value, seg.index);
		}

		if (value === null || value === undefined) return null;

		if (i < segments.length - 1) {
			if (canTraversePlainValue(value)) {
				currentContext = { kind: "value", value };
				continue;
			}

			const linkTarget = extractWikiLink(typeof value === "string" ? value : "");
			if (!linkTarget) {
				// Not a wiki-link — can't chain further
				return null;
			}

			const linkedFile = resolveLinkedFile(app, linkTarget, linkSourceFile.path);
			if (!linkedFile) return null;

			// Get the linked file's frontmatter
			const linkedCache = app.metadataCache.getFileCache(linkedFile);
			linkSourceFile = linkedFile;

			// Read body content of the linked file so that `.content`
			// works at every level of the chain
			const rawLinked = await app.vault.cachedRead(linkedFile);
			currentContext = {
				kind: "file",
				file: linkedFile,
				frontmatter: linkedCache?.frontmatter,
				bodyContent: stripFrontmatter(linkedCache, rawLinked),
			};
		} else {
			// Last segment — return the value
			return value;
		}
	}

	return null;
}

type ChainContext =
	| {
		kind: "file";
		file: TFile;
		frontmatter: Record<string, unknown> | undefined;
		bodyContent: string;
		bases?: TemplateBases;
	}
	| {
		kind: "value";
		value: unknown;
	};

function resolveChainSegment(context: ChainContext, key: string): unknown {
	if (context.kind === "value") {
		return resolvePlainValueSegment(context.value, key);
	}

	const currentFile = context.file;
	let value: unknown = undefined;

	// Check built-in file properties at every level — these work for
	// the source file and any linked file we've resolved to.
	if (key === "name") value = currentFile.name;
	else if (key === "basename") value = currentFile.basename;
	else if (key === "path") value = currentFile.path;
	else if (key === "folder") value = currentFile.parent?.path ?? "";
	else if (key === "ext" || key === "extension") value = currentFile.extension;
	else if (key === "size") value = currentFile.stat.size;
	else if (key === "ctime") value = currentFile.stat.ctime;
	else if (key === "mtime") value = currentFile.stat.mtime;
	else if (key === "content") value = context.bodyContent;
	else if (key === "bases" || key === "baseViews") value = buildBasesCollection(context.bases ?? []);

	// Check frontmatter only when no built-in value was found. Built-ins like
	// "content" should not be overridden by frontmatter.
	if (value === undefined && context.frontmatter && context.frontmatter[key] !== undefined) {
		value = context.frontmatter[key];
	}

	return value;
}

function resolvePlainValueSegment(value: unknown, key: string): unknown {
	if (Array.isArray(value)) {
		if (key === "length") return value.length;
		return (value as unknown as Record<string, unknown>)[key];
	}
	if (isRecord(value)) {
		return value[key];
	}
	return undefined;
}

function applySegmentIndex(value: unknown, index: number): unknown {
	if (Array.isArray(value)) {
		return index < value.length ? value[index] : null;
	}
	return null;
}

function canTraversePlainValue(value: unknown): boolean {
	return Array.isArray(value) || isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

/** Overlay element augmented with the CSS-scoping observer we attach during render. */
type ScopedContainer = HTMLElement & { __cvScopeObserver?: MutationObserver | null };
const MARKDOWN_VALUE_HINT_RE = /[![\]_*`~#>|<&\n\r]/;
const URL_VALUE_HINT_RE = /\bhttps?:\/\//i;
const SOURCE_CONTENT_CACHE_LIMIT = 200;

interface SourceContentCacheEntry {
	mtime: number;
	size: number;
	content: string;
}

const sourceContentCache = new WeakMap<App, Map<string, SourceContentCacheEntry>>();

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
 * @param allowJavaScript - Whether inline template scripts and per-view JavaScript should execute
 * @param sourceContent - Optional already-loaded note text from Obsidian's active view
 * @param basesProvider - Optional provider for embedded Obsidian Bases results
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
	allowJavaScript: boolean = true,
	sourceContent?: string,
	basesProvider?: BasesDataProvider,
) {
	const cache = app.metadataCache.getFileCache(file);
	const frontmatter = cache?.frontmatter;
	const rawContent = sourceContent ?? await readCachedSourceContent(app, file);
	const renderTemplateContent = stripTemplateBaseBlocks(template);

	const bodyContent = stripFrontmatter(cache, rawContent);
	const bases = await collectEmbeddedBasesIfNeeded(
		basesProvider,
		template,
		renderTemplateContent,
		viewConfig,
		app,
		file,
		rawContent,
		container.ownerDocument,
		component,
	);

	const markdownQueue: { id: string, content: string }[] = [];
	const contentPlaceholderId = `custom-view-content-${Date.now()}`;

	// Build expression context for logic blocks and expression mode
	const exprCtx: ExprContext = {
		app,
		file,
		frontmatter,
		bodyContent,
		variables: {},
		bases: bases as unknown as ExprValueArray,
		deferredMarkdown: {
			nextId: 0,
			values: {},
		},
	};

	// Process Clipper-style logic blocks first: {% if %}, {% for %}, {% set %}
	let processedTemplate = renderTemplateContent;
	if (renderTemplateContent.includes('{%')) {
		processedTemplate = await processLogicBlocks(renderTemplateContent, exprCtx);
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

		const finalValue = await resolveExprValue(innerExpr, exprCtx, app, file, frontmatter, bodyContent, bases);

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
			const renderedValue = resultToString(finalValue);
			if (needsMarkdownRender(renderedValue)) {
				const placeholderId = `cv-md-${markdownQueue.length}-${Date.now()}`;
				markdownQueue.push({ id: placeholderId, content: renderedValue });
				resolvedValues.push(`<span id="${placeholderId}"></span>`);
			} else {
				resolvedValues.push(escapeHtml(renderedValue));
			}
		}
	}

	const filledTemplate = applyReplacements(processedTemplate, matches, resolvedValues);

	// Use DOMParser to safely parse HTML instead of innerHTML
	const parser = new DOMParser();
	const doc = parser.parseFromString(filledTemplate, 'text/html');
	const tempContainer = doc.body;

	// Disconnect any previous CSS-scoping MutationObserver from a prior render
	const scoped = container as ScopedContainer;
	if (scoped.__cvScopeObserver) { scoped.__cvScopeObserver.disconnect(); scoped.__cvScopeObserver = null; }

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

			unwrapSingleParagraph(span);
		}
	}

	applyNativeInternalLinkState(app, container, file.path);

	const contentEl = container.querySelector(`#${contentPlaceholderId}`) as HTMLElement;
	if (contentEl) {
		if (editableMode) {
			// In editable mode, leave the placeholder empty — the caller will
			// reparent the real CM6 editor into it.
			contentEl.setAttribute(EDITABLE_PLACEHOLDER_ATTR, "true");
			contentEl.removeAttribute("id");
		} else {
			const sizer = container.ownerDocument.createElement("div");
			sizer.classList.add("markdown-preview-sizer", "markdown-preview-section");
			contentEl.appendChild(sizer);

			await MarkdownRenderer.render(app, bodyContent, sizer, file.path, component);
			contentEl.removeAttribute("id");
		}
	}

	// Inject CSS from the separate CSS field (with template resolution)
	if (viewConfig?.css) {
		const resolvedCss = await resolveTemplateRaw(app, viewConfig.css, file, frontmatter, bodyContent, bases);
		if (resolvedCss.trim()) {
			const styleEl = container.ownerDocument.createElement("style");
			styleEl.textContent = resolvedCss;
			container.prepend(styleEl);
		}
	}

	if (allowJavaScript) {
		const scripts = Array.from(container.querySelectorAll("script"));
		const hasExecutableInlineScripts = scripts.some(hasExecutableInlineScriptCode);
		const resolvedJs = viewConfig?.js?.trim()
			? await resolveTemplateRaw(app, viewConfig.js, file, frontmatter, bodyContent, bases)
			: "";
		const viewJs = resolvedJs.trim();

		if (hasExecutableInlineScripts || viewJs) {
			const scriptContext = createScriptContext(app, file, container, frontmatter, bodyContent, viewConfig);

			await executeScripts(scripts, scriptContext);

			if (viewJs) {
				try {
					await executeCustomViewJavaScript(viewJs, scriptContext);
				} catch (e) {
					console.error('[Custom Views] Error executing view JS:', e);
				}
			}
		} else {
			for (const script of scripts) {
				script.remove();
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
		(container as ScopedContainer).__cvScopeObserver = observer;
	}
}

function createScriptContext(
	app: App,
	file: TFile,
	container: HTMLElement,
	frontmatter: Record<string, unknown> | undefined,
	bodyContent: string,
	viewConfig: ViewConfig | undefined,
): CustomViewScriptContext {
	const ownerDocument = container.ownerDocument;
	return {
		app,
		file,
		container,
		frontmatter,
		bodyContent,
		viewConfig,
		activeDocument: ownerDocument,
		activeWindow: ownerDocument.defaultView ?? activeWindow,
	};
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

async function readCachedSourceContent(app: App, file: TFile): Promise<string> {
	const stat = file.stat;
	if (!stat) return app.vault.cachedRead(file);

	let cache = sourceContentCache.get(app);
	if (!cache) {
		cache = new Map();
		sourceContentCache.set(app, cache);
	}

	const cached = cache.get(file.path);
	if (cached && cached.mtime === stat.mtime && cached.size === stat.size) {
		cache.delete(file.path);
		cache.set(file.path, cached);
		return cached.content;
	}

	const content = await app.vault.cachedRead(file);
	cache.set(file.path, {
		mtime: stat.mtime,
		size: stat.size,
		content,
	});

	while (cache.size > SOURCE_CONTENT_CACHE_LIMIT) {
		const oldestKey = cache.keys().next().value as string | undefined;
		if (oldestKey === undefined) break;
		cache.delete(oldestKey);
	}

	return content;
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

function unwrapSingleParagraph(container: HTMLElement) {
	const p = container.querySelector("p");
	if (p && p.parentElement === container && container.children.length === 1) {
		p.replaceWith(...Array.from(p.childNodes));
	}
}

function needsMarkdownRender(value: string): boolean {
	return MARKDOWN_VALUE_HINT_RE.test(value) || URL_VALUE_HINT_RE.test(value);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function applyNativeInternalLinkState(app: App, container: HTMLElement, sourcePath: string) {
	const metadataCache = app.metadataCache as App["metadataCache"] & {
		getFirstLinkpathDest?: App["metadataCache"]["getFirstLinkpathDest"];
	};
	if (typeof metadataCache.getFirstLinkpathDest !== "function") return;

	const links = container.querySelectorAll<HTMLElement>(".internal-link");
	for (const link of Array.from(links)) {
		const target = getInternalLinkTarget(link);
		if (!target) continue;

		const resolved = metadataCache.getFirstLinkpathDest(target, sourcePath);
		link.classList.toggle("is-unresolved", !resolved);
	}
}

function getInternalLinkTarget(link: Element): string | null {
	const target = link.getAttribute("data-href") ?? link.getAttribute("href");
	if (!target || isExternalLinkTarget(target)) return null;
	return target;
}

function isExternalLinkTarget(target: string): boolean {
	return /^[a-z][a-z\d+.-]*:/i.test(target);
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
	bodyContent: string,
	bases: TemplateBases = [],
): Promise<unknown> {
	const deferredMarkdown = resolveDeferredMarkdownPlaceholder(innerExpr, exprCtx);
	if (deferredMarkdown.found) {
		return deferredMarkdown.value;
	}

	const directLookup = parseDirectPropertyLookup(innerExpr);
	if (directLookup) {
		const value = await resolvePropertyChain(app, directLookup.segments, file, frontmatter, bodyContent, bases);
		if (value !== null && value !== undefined) {
			if (directLookup.filterChain) {
				return applyFilterChain(value as Parameters<typeof applyFilterChain>[0], directLookup.filterChain);
			}
			return value;
		}
	}

	if (isExpressionMode(innerExpr)) {
		const rewritten = rewriteSlashPropertyReferences(innerExpr, frontmatter);
		if (rewritten) {
			return evaluateExpression(rewritten.expression, {
				...exprCtx,
				variables: {
					...exprCtx.variables,
					...rewritten.variables,
				},
			});
		}
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

	const value = await resolvePropertyChain(app, segments, file, frontmatter, bodyContent, bases);
	if (value === null || value === undefined) return null;

	if (filterChain) {
		return applyFilterChain(value as Parameters<typeof applyFilterChain>[0], filterChain);
	}

	return value;
}

function parseDirectPropertyLookup(expr: string): { segments: PropertySegment[]; filterChain?: string } | null {
	const pipeIdx = findFirstPipe(expr);
	const chain = (pipeIdx === -1 ? expr : expr.substring(0, pipeIdx)).trim();
	const canBeDirectLookup =
		chain.startsWith('"') ||
		chain.startsWith("'") ||
		chain.startsWith("[") ||
		chain.includes("/");
	if (!canBeDirectLookup) {
		return null;
	}

	const segments = parsePropertyPath(chain);
	if (segments.length !== 1) return null;

	return {
		segments,
		filterChain: pipeIdx === -1 ? undefined : expr.substring(pipeIdx + 1).trim(),
	};
}

function rewriteSlashPropertyReferences(
	expr: string,
	frontmatter: Record<string, unknown> | undefined,
): { expression: string; variables: ExprContext["variables"] } | null {
	const keys = Object.keys(frontmatter ?? {})
		.filter(key => key.includes("/"))
		.sort((a, b) => b.length - a.length);
	if (keys.length === 0 || !frontmatter) return null;

	let expression = "";
	const variables: ExprContext["variables"] = {};
	let replacementIndex = 0;
	let quote: string | null = null;
	let replaced = false;

	for (let i = 0; i < expr.length; i++) {
		const ch = expr[i];

		if (quote) {
			expression += ch;
			if (ch === "\\" && i + 1 < expr.length) {
				i++;
				expression += expr[i];
			} else if (ch === quote) {
				quote = null;
			}
			continue;
		}

		if (ch === '"' || ch === "'") {
			quote = ch;
			expression += ch;
			continue;
		}

		const key = keys.find(candidate =>
			expr.startsWith(candidate, i) &&
			isPropertyReferenceBoundary(expr, i, candidate.length)
		);
		if (key) {
			const variableName = `__cv_slash_prop_${replacementIndex++}`;
			variables[variableName] = frontmatter[key] as ExprContext["variables"][string];
			expression += variableName;
			i += key.length - 1;
			replaced = true;
			continue;
		}

		expression += ch;
	}

	return replaced ? { expression, variables } : null;
}

function isPropertyReferenceBoundary(expr: string, start: number, length: number): boolean {
	const before = start > 0 ? expr[start - 1] : "";
	const after = start + length < expr.length ? expr[start + length] : "";
	return !isIdentifierCharacter(before) && !isIdentifierCharacter(after);
}

function isIdentifierCharacter(ch: string): boolean {
	return /[a-zA-Z0-9_-]/.test(ch);
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
	bodyContent: string,
	bases: TemplateBases = [],
): Promise<string> {
	const exprCtx: ExprContext = {
		app,
		file,
		frontmatter,
		bodyContent,
		variables: {},
		bases: bases as unknown as ExprValueArray,
		deferredMarkdown: {
			nextId: 0,
			values: {},
		},
	};

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
		const value = await resolveExprValue(match.innerExpr, exprCtx, app, file, frontmatter, bodyContent, bases);
		resolvedValues.push(resultToString(value));
	}

	return applyReplacements(processedTemplate, matches, resolvedValues);
}

async function collectEmbeddedBasesIfNeeded(
	basesProvider: BasesDataProvider | undefined,
	templateContent: string,
	renderTemplateContent: string,
	viewConfig: ViewConfig | undefined,
	app: App,
	file: TFile,
	sourceContent: string,
	ownerDocument: Document,
	component: Component,
): Promise<TemplateBases> {
	if (!basesProvider || !templateReferencesBases(renderTemplateContent, viewConfig?.css, viewConfig?.js)) {
		return [];
	}
	if (!mayContainBaseSources(templateContent, sourceContent)) {
		return [];
	}

	return basesProvider.getEmbeddedBases({
		app,
		file,
		templateContent,
		sourceContent,
		ownerDocument,
		component,
	});
}

function mayContainBaseSources(templateContent: string, sourceContent: string): boolean {
	return /\{%\s*base\b/i.test(templateContent) ||
		/(^|\n)(`{3,}|~{3,})[ \t]*base(?:[ \t]|\n)/i.test(sourceContent) ||
		/\.base/i.test(sourceContent);
}

/**
 * Executes inline script tags collected from the parsed template.
 *
 * Scripts with a `src` attribute are intentionally ignored — loading external
 * scripts would allow arbitrary remote code execution, which violates
 * Obsidian's plugin guidelines.  Only inline script content (written by the
 * user directly in their template) is evaluated through the bundled WASM
 * template engine rather than DOM `<script>` injection, so external URLs
 * are never loaded.
 */
async function executeScripts(
	scripts: HTMLScriptElement[],
	scriptContext: CustomViewScriptContext,
): Promise<void> {
	for (const script of scripts) {
		// Silently drop src-based scripts — external code must never be loaded.
		if (!script.src) {
			const code = script.textContent?.trim();
			if (code) {
				try {
					await executeCustomViewJavaScript(code, scriptContext);
				} catch (e) {
					console.error('[Custom Views] Error executing template script:', e);
				}
			}
		}
		script.remove();
	}
}

function hasExecutableInlineScriptCode(script: HTMLScriptElement): boolean {
	return !script.src && !!script.textContent?.trim();
}
