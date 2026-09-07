import type { EditorView } from "@codemirror/view";
import { holdEmbeddedView } from "./embedded-transition";
import { MarkdownView, TFile, type App } from "obsidian";
import { getTemplateDependencies } from "./renderer";
import type { ViewContext } from "./types";

type Method = (...args: unknown[]) => unknown;
interface Embed {
	containerEl: HTMLElement;
	file: TFile;
	subpath?: string;
	text?: string;
	data?: string;
	editMode?: { sourceMode?: boolean };
	editorEl?: HTMLElement;
	editor?: MarkdownView["editor"];
	getMode?(): string;
	[key: string]: unknown;
}
type Factory = (...args: unknown[]) => unknown;
interface Entry { embed: Embed; view: MarkdownView; key?: string; restore: (() => void)[]; finishTransition?: () => void; point?: { x: number; y: number }; scrollTop?: number; generation: number }

/** Observe the host's own Markdown embeds, preserving their editor and mode controls. */
export class EmbeddedViews {
	private entries = new Map<Embed, Entry>();
	private stopped = false;
	private observers = new Map<Document, MutationObserver>();
	private restoreFactory?: () => void;
	constructor(private app: App, private enabled: (context: ViewContext) => boolean,
		private render: (view: MarkdownView, context: ViewContext, changed: boolean) => Promise<void>,
		private reset: (view: MarkdownView) => void) {
		const registry = (app as unknown as { embedRegistry?: { embedByExtension?: Record<string, Factory> } }).embedRegistry?.embedByExtension;
		const original = registry?.md;
		if (!registry || !original) return;
		const register = (embed: unknown) => { if (!this.stopped) this.track(embed); };
		const wrapped: Factory = function (...args) {
			const embed = original.apply(this, args);
			register(embed);
			return embed;
		};
		registry.md = wrapped;
		this.restoreFactory = () => { if (registry.md === wrapped) registry.md = original; };
	}
	track(value: unknown): boolean {
		if (!value || typeof value !== "object") return false;
		const embed = value as Embed;
		if (!embed.containerEl || !(embed.file instanceof TFile) || !embed.file.path.toLowerCase().endsWith(".md") ||
			(typeof embed.getMode !== "function" && typeof embed.loadFile !== "function")) return false;
		if (this.entries.has(embed)) return true;
		const view = Object.create(MarkdownView.prototype) as MarkdownView;
		Object.defineProperties(view, {
			cvEditorEl: { get: () => embed.editorEl },
			contentEl: { get: () => embed.containerEl }, file: { get: () => embed.file }, editor: { get: () => embed.editor },
		});
		view.getState = () => ({ mode: (embed.getMode?.() ?? "preview"), source: !!embed.editMode?.sourceMode });
		view.getViewData = () => embed.editor?.getValue() ?? embed.data ?? embed.text ?? "";
		const doc = embed.containerEl.ownerDocument;
		if (!this.observers.has(doc) && doc.body) {
			const Observer = doc.defaultView?.MutationObserver;
			if (Observer) {
				const observer = new Observer(() => this.refresh());
				observer.observe(doc.body, { childList: true, subtree: true });
				this.observers.set(doc, observer);
			}
		}
		const entry: Entry = { embed, view, restore: [], generation: 0 };
		this.entries.set(embed, entry);
		for (const name of ["set", "showEditor", "showPreview", "unload"]) {
			const original = embed[name];
			if (typeof original !== "function") continue;
			const owned = Object.prototype.hasOwnProperty.call(embed, name);
			const wrapper: Method = (...args) => {
				if (name === "unload") this.release(entry);
				else if (name !== "set") {
					const overlay = embed.containerEl.querySelector<HTMLElement>(":scope > .obsidian-custom-view-render");
					if (name === "showEditor" && overlay) {
						const point = args[0] as { x?: unknown; y?: unknown } | undefined;
						entry.point = point && typeof point.x === "number" && typeof point.y === "number" ? { x: point.x, y: point.y } : undefined;
						// Native coordinate conversion runs before we place the editor.
						// Defer it until the final custom layout is ready.
						args = [];
						if (embed.getMode?.() === "source") { this.placeCursor(entry); return; }
					}
					entry.finishTransition?.();
					entry.scrollTop = overlay?.scrollTop;
					entry.finishTransition = holdEmbeddedView(embed.containerEl);
					this.reset(view); entry.key = undefined; entry.generation++;
				}
				const result: unknown = (original as Method).apply(embed, args);
				if (name !== "unload") queueMicrotask(() => this.refreshEntry(entry));
				return result;
			};
			embed[name] = wrapper;
			entry.restore.push(() => { if (embed[name] === wrapper) { if (owned) embed[name] = original; else delete embed[name]; } });
		}
		queueMicrotask(() => this.refreshEntry(entry));
		return true;
	}
	refresh(force = false) { for (const entry of this.entries.values()) { if (force) entry.key = undefined; this.refreshEntry(entry); } }
	private refreshEntry(entry: Entry) {
		if (this.stopped || !this.entries.has(entry.embed)) return;
		const { embed, view } = entry;
		const root = embed.containerEl;
		if (!root.isConnected) return;
		const context: ViewContext = root.closest(".hover-popover") ? "popover" : root.closest(".canvas-node") ? "canvas" : "embed";
		const cannotMoveFrame = embed.editorEl?.querySelector("iframe") && typeof (root as HTMLElement & { moveBefore?: unknown }).moveBefore !== "function";
		if (cannotMoveFrame || embed.subpath || root.parentElement?.closest(".obsidian-custom-view-render") || !this.enabled(context)) {
			entry.finishTransition?.(); entry.finishTransition = undefined; entry.point = undefined;
			this.reset(view); entry.key = undefined; return;
		}
		const mode = embed.getMode?.() ?? "preview";
		const overlay = root.querySelector<HTMLElement>(":scope > .obsidian-custom-view-render");
		// The live editor already owns body changes; refresh only if the template
		// also rendered a read-only copy or the note's properties changed.
		const trackBody = mode !== "source" || !root.classList.contains("obsidian-custom-view-editable") || !!(overlay && getTemplateDependencies(overlay)?.has(embed.file));
		const key = JSON.stringify([context, embed.file.path, trackBody ? embed.file.stat.mtime : null,
			mode, embed.editMode?.sourceMode, trackBody ? embed.text : null, this.app.metadataCache?.getFileCache(embed.file)?.frontmatter]);
		const changed = entry.key !== key;
		if (!changed && root.getAttribute("data-cv-state") && root.querySelector(".obsidian-custom-view-render")) return;
		entry.key = key;
		root.classList.remove("cv-context-popover", "cv-context-canvas", "cv-context-embed");
		root.classList.add(`cv-context-${context}`);
		const generation = entry.generation;
		void this.render(view, context, changed).then(() => {
			if (!this.entries.has(embed) || generation !== entry.generation) return;
			const overlay = root.querySelector<HTMLElement>(":scope > .obsidian-custom-view-render");
			if (overlay && entry.scrollTop !== undefined) overlay.scrollTop = entry.scrollTop;
			entry.scrollTop = undefined;
			this.placeCursor(entry);
			entry.finishTransition?.(); entry.finishTransition = undefined;
		}).catch(error => {
			if (generation !== entry.generation) return;
			entry.finishTransition?.(); entry.finishTransition = undefined;
			entry.key = undefined; this.reset(view);
			console.error("[Custom Views] Could not render embedded note:", error);
		});
	}
	private placeCursor(entry: Entry) {
		const editor: unknown = entry.embed.editor;
		const cm = (editor as { cm?: EditorView } | undefined)?.cm;
		const point = entry.point; entry.point = undefined;
		if (!cm || !point) return;
		const frame = entry.embed.editorEl?.querySelector("iframe");
		let coords = point;
		if (frame) {
			const rect = frame.getBoundingClientRect();
			const scale = rect.width / frame.clientWidth;
			if (!scale) return;
			coords = { x: (point.x - rect.left) / scale, y: (point.y - rect.top) / scale };
		}
		cm.requestMeasure({ read: () => cm.posAtCoords(coords, false), write: position => queueMicrotask(() => {
			if (position !== null && cm.dom.isConnected) {
				cm.dispatch({ selection: { anchor: position }, userEvent: "select.pointer" });
				cm.focus();
			}
		}) });
	}

	private release(entry: Entry) {
		entry.generation++;
		entry.finishTransition?.();
		this.entries.delete(entry.embed);
		this.reset(entry.view);
		entry.embed.containerEl.classList.remove("cv-context-popover", "cv-context-canvas", "cv-context-embed");
		for (const restore of entry.restore) restore();
	}
	dispose() {
		this.stopped = true;
		this.restoreFactory?.();
		for (const observer of this.observers.values()) observer.disconnect();
		this.observers.clear();
		for (const entry of this.entries.values()) this.release(entry);
	}
}
