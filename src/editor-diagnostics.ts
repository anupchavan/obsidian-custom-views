import { StateEffect, StateField, type ChangeDesc, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, showPanel, type Panel, type ViewUpdate } from "@codemirror/view";
import { setIcon } from "obsidian";
import { createDetachedEl } from "./dom";
import { scriptErrorPosition, type TemplateDiagnostic } from "./template-diagnostics";
import type { ScriptErrorSource } from "./renderer";

/** Problems found while the preview ran this editor's code, such as a thrown error. */
export const setRuntimeDiagnostics = StateEffect.define<TemplateDiagnostic[]>();
const setStaticDiagnostics = StateEffect.define<TemplateDiagnostic[]>();
/** Sent once the list has finished collapsing after the last problem was fixed. */
const closeList = StateEffect.define<null>();

/** `open` outlives the last problem by one collapse animation. */
interface DiagnosticState { found: TemplateDiagnostic[]; runtime: TemplateDiagnostic[]; open: boolean }

/** New problems wait for a pause in typing; fixes clear at once. */
export const NEW_PROBLEM_DELAY = 700;

function mapDiagnostic(diagnostic: TemplateDiagnostic, changes: ChangeDesc): TemplateDiagnostic {
	if (diagnostic.from === undefined) return diagnostic;
	const from = changes.mapPos(diagnostic.from, 1);
	return { ...diagnostic, from, to: Math.max(from, changes.mapPos(diagnostic.to ?? diagnostic.from, -1)) };
}

const sameProblem = (a: TemplateDiagnostic, b: TemplateDiagnostic) =>
	a.message === b.message && a.from === b.from && a.to === b.to;

/**
 * Pele-style diagnostics: a list below the editor (so appearing never moves
 * the text being typed) plus an underline at each location. `analyze` must be
 * cheap and pure; it runs again after each pause in typing.
 */
export function diagnosticsExtension(analyze: (source: string) => TemplateDiagnostic[]): Extension {
	const run = (doc: Text) => {
		try { return analyze(doc.toString()); }
		catch (error) {
			console.error("[Custom Views] Could not check this code:", error);
			return [];
		}
	};
	const field = StateField.define<DiagnosticState>({
		create: state => {
			const found = run(state.doc);
			return { found, runtime: [], open: found.length > 0 };
		},
		update(value, transaction) {
			let { found, runtime, open } = value;
			if (transaction.docChanged) {
				found = found.map(diagnostic => mapDiagnostic(diagnostic, transaction.changes));
				runtime = runtime.map(diagnostic => mapDiagnostic(diagnostic, transaction.changes));
			}
			for (const effect of transaction.effects) {
				if (effect.is(setStaticDiagnostics)) found = effect.value;
				if (effect.is(setRuntimeDiagnostics)) runtime = effect.value;
				if (effect.is(closeList)) open = false;
			}
			if (found.length || runtime.length) open = true;
			return found === value.found && runtime === value.runtime && open === value.open ? value : { found, runtime, open };
		},
	});
	const all = (state: EditorState) => {
		const { found, runtime } = state.field(field);
		return runtime.length ? [...found, ...runtime].sort((a, b) => (a.from ?? -1) - (b.from ?? -1)) : found;
	};

	const scheduler = ViewPlugin.fromClass(class {
		private timer?: number;
		constructor(private view: EditorView) {}
		update(update: ViewUpdate) {
			if (!update.docChanged) return;
			const win = this.view.dom.ownerDocument.defaultView ?? window;
			win.clearTimeout(this.timer);
			const current = update.state.field(field).found;
			const next = run(update.state.doc);
			const onlyFixes = next.every(diagnostic => current.some(shown => sameProblem(shown, diagnostic)));
			this.timer = win.setTimeout(() => {
				this.timer = undefined;
				this.view.dispatch({ effects: setStaticDiagnostics.of(run(this.view.state.doc)) });
			}, onlyFixes ? 0 : NEW_PROBLEM_DELAY);
		}
		destroy() {
			(this.view.dom.ownerDocument.defaultView ?? window).clearTimeout(this.timer);
		}
	});

	const underlines = EditorView.decorations.compute([field], state => {
		const ranges = [];
		for (const diagnostic of all(state)) {
			if (diagnostic.from === undefined) continue;
			let from = Math.min(diagnostic.from, state.doc.length), to = Math.min(diagnostic.to ?? from, state.doc.length);
			// An empty range has nothing to underline; mark the character before it.
			if (to <= from) { if (from >= state.doc.length) from = Math.max(0, from - 1); to = Math.min(state.doc.length, from + 1); }
			if (to > from) ranges.push(Decoration.mark({ class: `cv-diagnostic-mark is-${diagnostic.severity}` }).range(from, to));
		}
		return Decoration.set(ranges, true);
	});

	const createPanel = (view: EditorView): Panel => {
		const dom = createDetachedEl(view.dom.ownerDocument, "div");
		dom.className = "cv-diagnostics";
		dom.setAttribute("role", "status");
		let shown: readonly TemplateDiagnostic[] = [];
		const collapse = new Collapse(view, dom);
		const render = (state: EditorState) => {
			const list = all(state);
			if (list === shown) return;
			shown = list;
			// The last problem was fixed: keep showing it while the list folds away.
			if (!list.length) { collapse.start(); return; }
			collapse.cancel();
			renderDiagnostics(dom, view, list);
			keepCaretVisible(view, dom);
		};
		render(view.state);
		return {
			dom,
			mount: () => keepCaretVisible(view, dom),
			update: update => render(update.state),
			destroy: () => collapse.cancel(),
		};
	};

	return [
		field,
		scheduler,
		underlines,
		showPanel.compute([field], state => state.field(field).open ? createPanel : null),
	];
}

/** Room left between the caret and the list, so the line being typed never touches it. */
const CARET_MARGIN = 8;

/**
 * The list takes its height from the code above it. When that would cover the
 * line being typed, scroll just enough to keep it in sight. A caret that was
 * already out of view (the person scrolled away) stays where it is.
 */
function keepCaretVisible(view: EditorView, list: HTMLElement) {
	view.requestMeasure({
		key: keepCaretVisible,
		read() {
			if (!view.hasFocus) return 0;
			const caret = view.coordsAtPos(view.state.selection.main.head);
			if (!caret) return 0;
			const bottom = view.scrollDOM.getBoundingClientRect().bottom;
			const covered = caret.bottom + CARET_MARGIN - bottom;
			return covered > 0 && caret.top < bottom + list.offsetHeight ? covered : 0;
		},
		write(covered) {
			if (covered > 0) view.scrollDOM.scrollTop += covered;
		},
	});
}

/** How long the list takes to fold away. Matches the transition in styles.css. */
export const COLLAPSE_MS = 160;

/**
 * Folds the list away instead of removing it in one frame, so the code below
 * slides back into place rather than jumping.
 */
class Collapse {
	private timer?: number;
	constructor(private view: EditorView, private dom: HTMLElement) {}

	/** The panel's frame: its own box, or the shared container when it is alone there. */
	private get target() {
		const parent = this.dom.parentElement;
		return parent?.childElementCount === 1 ? parent : this.dom;
	}

	start() {
		if (this.timer !== undefined) return;
		const win = this.view.dom.ownerDocument.defaultView ?? window;
		const finish = () => {
			this.timer = undefined;
			this.view.dispatch({ effects: closeList.of(null) });
		};
		if (win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
			this.timer = win.setTimeout(finish, 0);
			return;
		}
		const target = this.target;
		// Pin the current height, then let the transition take it to zero.
		target.style.setProperty("--cv-diagnostics-height", `${target.offsetHeight}px`);
		target.classList.add("cv-diagnostics-pinned");
		void target.offsetHeight;
		target.classList.add("cv-diagnostics-collapsing");
		this.timer = win.setTimeout(finish, COLLAPSE_MS);
	}

	cancel() {
		if (this.timer === undefined) return;
		(this.view.dom.ownerDocument.defaultView ?? window).clearTimeout(this.timer);
		this.timer = undefined;
		const target = this.target;
		target.classList.remove("cv-diagnostics-pinned", "cv-diagnostics-collapsing");
		target.style.removeProperty("--cv-diagnostics-height");
	}
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/** Up to this many problems are listed; the rest are counted. */
const LISTED = 20;
/** Characters of source shown around a problem on a long line. */
const FRAME_WIDTH = 72;

function renderDiagnostics(dom: HTMLElement, view: EditorView, list: readonly TemplateDiagnostic[]) {
	dom.replaceChildren();
	const doc = dom.ownerDocument;
	for (const diagnostic of list.slice(0, LISTED)) {
		const item = dom.appendChild(createDetachedEl(doc, "div"));
		item.className = `cv-diagnostic is-${diagnostic.severity}`;
		const located = diagnostic.from !== undefined && diagnostic.from <= view.state.doc.length;
		const title = item.appendChild(createDetachedEl(doc, located ? "button" : "div"));
		title.className = "cv-diagnostic-title";
		const icon = title.appendChild(createDetachedEl(doc, "span"));
		icon.className = "cv-diagnostic-icon";
		setIcon(icon, diagnostic.severity === "error" ? "triangle-alert" : "circle-alert");
		const label = title.appendChild(createDetachedEl(doc, "span"));
		const line = located ? view.state.doc.lineAt(diagnostic.from!) : undefined;
		if (line) label.append(`Line ${line.number}, column ${diagnostic.from! - line.from + 1}: `);
		appendCode(label, diagnostic.message);
		if (line && title instanceof HTMLButtonElement) {
			title.type = "button";
			title.setAttribute("aria-label", `${label.textContent ?? ""}. Go to this location.`);
			title.addEventListener("click", () => {
				const from = Math.min(diagnostic.from!, view.state.doc.length);
				const to = Math.min(Math.max(from, diagnostic.to ?? from), view.state.doc.length);
				view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
				view.focus();
			});
		}
		if (line) {
			const frame = item.appendChild(createDetachedEl(doc, "pre"));
			frame.className = "cv-diagnostic-frame";
			const { text, caretAt, caretLength } = codeFrame(line.text, diagnostic.from! - line.from, (diagnostic.to ?? diagnostic.from!) - line.from);
			frame.append(`${text}\n${" ".repeat(caretAt)}`);
			const caret = frame.appendChild(createDetachedEl(doc, "span"));
			caret.className = "cv-diagnostic-caret";
			caret.textContent = "^".repeat(caretLength);
		}
		if (diagnostic.hint) {
			const hint = item.appendChild(createDetachedEl(doc, "div"));
			hint.className = "cv-diagnostic-hint";
			appendCode(hint, diagnostic.hint);
		}
	}
	if (list.length > LISTED) {
		const more = dom.appendChild(createDetachedEl(doc, "div"));
		more.className = "cv-diagnostic-more";
		more.textContent = `${list.length - LISTED} more ${list.length - LISTED === 1 ? "problem" : "problems"} not shown.`;
	}
}

/** Backticked spans become inline code. */
function appendCode(parent: HTMLElement, text: string) {
	text.split("`").forEach((part, index) => {
		if (!part) return;
		if (index % 2) parent.appendChild(createDetachedEl(parent.ownerDocument, "code")).textContent = part;
		else parent.append(part);
	});
}

/** One source line, dedented and windowed, with the caret position inside it. */
export function codeFrame(lineText: string, from: number, to: number): { text: string; caretAt: number; caretLength: number } {
	// Tabs become spaces so the caret lines up under them.
	let text = lineText.replace(/\t/g, "  ");
	const tabsBefore = (end: number) => (lineText.slice(0, end).match(/\t/g)?.length ?? 0);
	let start = from + tabsBefore(from);
	let end = Math.max(start + 1, Math.min(to + tabsBefore(to), text.length));
	const indent = text.length - text.trimStart().length;
	const cut = Math.min(indent, start);
	text = text.slice(cut).trimEnd();
	start -= cut; end -= cut;
	if (text.length > FRAME_WIDTH) {
		const left = Math.max(0, Math.min(start - Math.floor(FRAME_WIDTH / 3), text.length - FRAME_WIDTH));
		const prefix = left > 0 ? "…" : "", suffix = left + FRAME_WIDTH < text.length ? "…" : "";
		text = prefix + text.slice(left, left + FRAME_WIDTH) + suffix;
		start += prefix.length - left; end += prefix.length - left;
		end = Math.min(end, text.length - suffix.length);
	}
	return { text, caretAt: Math.max(0, start), caretLength: Math.max(1, end - start) };
}

/** A problem for an error the preview's script threw, placed in the code when the stack allows. */
export function scriptErrorDiagnostic(error: unknown, source: ScriptErrorSource, docText: string, noteName: string): TemplateDiagnostic {
	const message = error instanceof Error ? `${error.name}: ${error.message}` : `Error: ${String(error)}`;
	const hint = `Thrown when the preview ran this on ${noteName}.`;
	const base = source.kind === "inline" ? docText.indexOf(source.code) : 0;
	const at = scriptErrorPosition(error);
	if (!at || base === -1) return { severity: "error", message, hint };
	const lines = docText.slice(base).split("\n");
	if (at.line > lines.length) return { severity: "error", message, hint };
	let from = base;
	for (let index = 0; index < at.line - 1; index++) from += lines[index].length + 1;
	const line = lines[at.line - 1];
	from += Math.min(Math.max(0, at.column - 1), line.length);
	const word = /^[\w$]+/.exec(docText.slice(from))?.[0];
	return { from, to: from + (word?.length ?? 1), severity: "error", message, hint };
}
