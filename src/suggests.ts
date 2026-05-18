import {
	App,
	AbstractInputSuggest,
	TFolder,
	prepareFuzzySearch,
	renderResults,
	SearchResult,
	setIcon,
	getAllTags,
	Notice
} from "obsidian";

/**
 * Suggestion item with optional metadata for rendering
 */
interface SuggestItem {
	/** The raw value stored when selected */
	value: string;
	/** Display text shown in the suggestion (may differ from value, e.g. stripped wikilinks) */
	display: string;
	/** Whether this item is a wikilink value */
	isWikilink?: boolean;
	/** Fuzzy search result for highlight rendering */
	matchResult?: SearchResult;
}

// ─── Base class with common patterns ────────────────────────────────────────

abstract class BaseSuggest extends AbstractInputSuggest<SuggestItem> {
	protected onSelectCallback: ((value: string) => void) | null = null;
	/** Live reference to values that should be excluded from suggestions */
	protected excludeValues: string[] = [];

	constructor(app: App, inputEl: HTMLInputElement | HTMLDivElement) {
		super(app, inputEl);
		this.limit = 50;
		// Add native Obsidian class for property-value suggest styling
		(this as any).suggestEl?.addClass("mod-property-value");
	}

	/**
	 * Sets a live reference to values that should be excluded from suggestions.
	 * The array is checked on every getSuggestions call, so mutations are reflected.
	 */
	setExcludeValues(values: string[]): this {
		this.excludeValues = values;
		return this;
	}

	protected filterItems(items: SuggestItem[], query: string): SuggestItem[] {
		// Filter out already-selected values
		if (this.excludeValues.length > 0) {
			items = items.filter(item => !this.excludeValues.includes(item.value));
		}

		if (!query || query.trim() === "") {
			// Clear any stale match results for unfiltered items
			for (const item of items) {
				item.matchResult = undefined;
			}
			return items.slice(0, this.limit);
		}

		const fuzzy = prepareFuzzySearch(query);
		const results: { item: SuggestItem; score: number }[] = [];

		for (const item of items) {
			const result = fuzzy(item.display);
			if (result) {
				item.matchResult = result;
				results.push({ item, score: result.score });
			}
		}

		results.sort((a, b) => a.score - b.score);
		return results.map(r => r.item);
	}

	/**
	 * Renders display text with fuzzy match highlighting into an element.
	 * Falls back to plain text if no match result is available.
	 */
	protected renderHighlightedText(el: HTMLElement, item: SuggestItem): void {
		if (item.matchResult) {
			renderResults(el, item.display, item.matchResult);
		} else {
			el.setText(item.display);
		}
	}

	selectSuggestion(item: SuggestItem, _evt: MouseEvent | KeyboardEvent): void {
		if (this.onSelectCallback) {
			this.onSelectCallback(item.value);
		}
		this.close();
	}

	/**
	 * Selects the currently highlighted suggestion, if any.
	 * Returns true if a suggestion was selected.
	 */
	selectHighlighted(): boolean {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const suggestEl = (this as any).suggestEl as HTMLElement | undefined;
		const selected = suggestEl?.querySelector('.suggestion-item.is-selected') as HTMLElement;
		if (selected) {
			selected.click();
			return true;
		}
		return false;
	}

	onSelectCb(callback: (value: string) => void): this {
		this.onSelectCallback = callback;
		return this;
	}
}

// ─── File Suggest ───────────────────────────────────────────────────────────
/**
 * Suggests file names from the vault for "links to" / "does not link to" operators.
 * Renders as simple nowrap text items like Obsidian bases:
 *   "Books", "Music/Belinda Says", "Movies/Interstellar"
 */
export class FileSuggest extends BaseSuggest {
	getSuggestions(query: string): SuggestItem[] {
		const files = this.app.vault.getMarkdownFiles();

		const items: SuggestItem[] = files.map(f => {
			const pathWithoutExt = f.path.replace(/\.md$/, "");
			return {
				value: pathWithoutExt,
				display: pathWithoutExt
			};
		});

		items.sort((a, b) => a.display.localeCompare(b.display));
		return this.filterItems(items, query);
	}

	renderSuggestion(item: SuggestItem, el: HTMLElement): void {
		el.addClass("mod-nowrap");
		this.renderHighlightedText(el, item);
	}
}

// ─── Folder Suggest ─────────────────────────────────────────────────────────
/**
 * Suggests folder paths from the vault for "in folder" / "is not in folder" operators.
 */
export class FolderSuggest extends BaseSuggest {
	private getAllFolders(): TFolder[] {
		const folders: TFolder[] = [];
		const collectFolders = (folder: TFolder) => {
			if (!folder.isRoot()) {
				folders.push(folder);
			}
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					collectFolders(child);
				}
			}
		};
		collectFolders(this.app.vault.getRoot());
		return folders;
	}

	getSuggestions(query: string): SuggestItem[] {
		const folders = this.getAllFolders();
		const items: SuggestItem[] = [
			// Include root folder as "/"
			{ value: "/", display: "/" },
			...folders.map(f => ({
				value: f.path,
				display: f.path
			}))
		];

		items.sort((a, b) => a.display.localeCompare(b.display));
		return this.filterItems(items, query);
	}

	renderSuggestion(item: SuggestItem, el: HTMLElement): void {
		el.addClass("mod-nowrap");
		this.renderHighlightedText(el, item);
	}
}

// ─── Tag Suggest ────────────────────────────────────────────────────────────
/**
 * Suggests tags from the vault for "has tag" / "does not have tag" and
 * "file tags" field operators. Tags stored without # prefix.
 */
export class TagSuggest extends BaseSuggest {
	private getAllVaultTags(): string[] {
		const tagSet = new Set<string>();
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache) {
				const tags = getAllTags(cache);
				if (tags) {
					for (const tag of tags) {
						tagSet.add(tag.replace(/^#+/, ""));
					}
				}
			}
		}

		return Array.from(tagSet).sort();
	}

	getSuggestions(query: string): SuggestItem[] {
		const tags = this.getAllVaultTags();
		const items: SuggestItem[] = tags.map(t => ({
			value: t,
			display: t
		}));

		return this.filterItems(items, query);
	}

	renderSuggestion(item: SuggestItem, el: HTMLElement): void {
		el.addClass("mod-nowrap");
		this.renderHighlightedText(el, item);
	}
}

// ─── Property Suggest ───────────────────────────────────────────────────────
/**
 * Suggests property names for "has property" / "does not have property".
 */
export class PropertySuggest extends BaseSuggest {
	private getAllPropertyNames(): string[] {
		const propSet = new Set<string>();
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter) {
				for (const key of Object.keys(cache.frontmatter)) {
					if (key === "position") continue;
					propSet.add(key);
				}
			}
		}

		return Array.from(propSet).sort();
	}

	getSuggestions(query: string): SuggestItem[] {
		const props = this.getAllPropertyNames();
		const items: SuggestItem[] = props.map(p => ({
			value: p,
			display: p
		}));

		return this.filterItems(items, query);
	}

	renderSuggestion(item: SuggestItem, el: HTMLElement): void {
		el.addClass("mod-nowrap");
		this.renderHighlightedText(el, item);
	}
}

// ─── Frontmatter Value Suggest ──────────────────────────────────────────────
/**
 * Suggests existing values for a specific frontmatter property.
 * Wikilink values render with link icon on the right (like Obsidian bases).
 * Non-wikilink values render as simple nowrap text.
 */
export class FrontmatterValueSuggest extends BaseSuggest {
	private propertyKey: string;

	constructor(app: App, inputEl: HTMLInputElement | HTMLDivElement, propertyKey: string) {
		super(app, inputEl);
		this.propertyKey = propertyKey;
	}

	private getExistingValues(): string[] {
		const valueSet = new Set<string>();
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter && this.propertyKey in cache.frontmatter) {
				const val = cache.frontmatter[this.propertyKey];
				if (val === null || val === undefined) continue;

				if (Array.isArray(val)) {
					for (const item of val) {
						const str = String(item).trim();
						if (str.length > 0) valueSet.add(str);
					}
				} else {
					const str = String(val).trim();
					if (str.length > 0) valueSet.add(str);
				}
			}
		}

		return Array.from(valueSet).sort();
	}

	getSuggestions(query: string): SuggestItem[] {
		const values = this.getExistingValues();
		const items: SuggestItem[] = values.map(v => {
			const wikilink = isWikilink(v);
			return {
				value: v,
				display: wikilink ? extractWikilinkDisplay(v) : v,
				isWikilink: wikilink
			};
		});

		return this.filterItems(items, query);
	}

	renderSuggestion(item: SuggestItem, el: HTMLElement): void {
		if (item.isWikilink) {
			// Match Obsidian bases: mod-complex with link icon on the right
			el.addClass("mod-complex");

			const content = el.createDiv({ cls: "suggestion-content" });
			const titleEl = content.createDiv({ cls: "suggestion-title" });
			this.renderHighlightedText(titleEl, item);
			content.createDiv({ cls: "suggestion-note" });

			const aux = el.createDiv({ cls: "suggestion-aux" });
			const flair = aux.createSpan({ cls: "suggestion-flair" });
			setIcon(flair, "link");
		} else {
			el.addClass("mod-nowrap");
			this.renderHighlightedText(el, item);
		}
	}
}


// ─── Wikilink Helpers ───────────────────────────────────────────────────────

/**
 * Checks if a string is a wikilink: [[...]]
 */
export function isWikilink(text: string): boolean {
	const t = text.trim();
	return t.startsWith("[[") && t.endsWith("]]") && t.length > 4;
}

/**
 * Extracts the link target from a wikilink: [[Target]] → Target, [[Target|Alias]] → Target
 */
export function extractWikilinkTarget(text: string): string {
	const t = text.trim();
	if (!t.startsWith("[[") || !t.endsWith("]]")) return text;
	const inner = t.slice(2, -2);
	const pipe = inner.indexOf("|");
	return pipe >= 0 ? inner.slice(0, pipe) : inner;
}

/**
 * Extracts the display text from a wikilink: [[Target|Alias]] → Alias, [[Target]] → Target
 */
export function extractWikilinkDisplay(text: string): string {
	const t = text.trim();
	if (!t.startsWith("[[") || !t.endsWith("]]")) return text;
	const inner = t.slice(2, -2);
	const pipe = inner.indexOf("|");
	return pipe >= 0 ? inner.slice(pipe + 1) : inner;
}

/**
 * Opens a file by link path in the background and shows a notice
 */
export function openWikilinkFile(app: App, linkTarget: string): void {
	const file = app.metadataCache.getFirstLinkpathDest(linkTarget, "");
	if (file) {
		const leaf = app.workspace.getLeaf("tab");
		leaf.openFile(file).then(() => {
			new Notice(`Opened "${file.basename}"`);
		});
	} else {
		new Notice(`File not found: ${linkTarget}`);
	}
}
