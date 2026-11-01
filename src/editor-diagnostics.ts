import { Prec, StateEffect, StateField, type ChangeDesc, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, showPanel, showTooltip, type Panel, type Tooltip, type ViewUpdate } from "@codemirror/view";
import { setIcon } from "obsidian";
import { createDetachedEl } from "./dom";
import { scriptErrorPosition, type TemplateDiagnostic } from "./template-diagnostics";
import type { ScriptErrorSource } from "./renderer";

/** Problems found while the preview ran this editor's code, such as a thrown error. */
export const setRuntimeDiagnostics = StateEffect.define<TemplateDiagnostic[]>();
const setStaticDiagnostics = StateEffect.define<TemplateDiagnostic[]>();
/** Sent once the list has finished collapsing after the last problem was fixed. */
const closeList = StateEffect.define<null>();
/** Opens a line's full messages by the line's start, or closes them when given the open line or null. */
const toggleIssues = StateEffect.define<number | null>();

interface DiagnosticState {
	found: TemplateDiagnostic[];
	runtime: TemplateDiagnostic[];
	/** Problems with a place in the code, in document order. Shown on their line. */
	located: TemplateDiagnostic[];
	/** Problems with no place, like an error thrown from somewhere we can't map. Listed under the code. */
	loose: TemplateDiagnostic[];
	/** Whether the list of loose problems is showing; it outlives the last one by one collapse. */
	open: boolean;
	/** Start of the line whose full messages are showing in a popover, if any. */
	popover: number | null;
}

/** New problems wait for a pause in typing; fixes clear at once. */
export const NEW_PROBLEM_DELAY = 700;

function mapDiagnostic(diagnostic: TemplateDiagnostic, changes: ChangeDesc): TemplateDiagnostic {
	if (diagnostic.from === undefined) return diagnostic;
	const from = changes.mapPos(diagnostic.from, 1);
	return { ...diagnostic, from, to: Math.max(from, changes.mapPos(diagnostic.to ?? diagnostic.from, -1)) };
}

const sameProblem = (a: TemplateDiagnostic, b: TemplateDiagnostic) =>
	a.message === b.message && a.from === b.from && a.to === b.to;

function split(found: TemplateDiagnostic[], runtime: TemplateDiagnostic[], length: number) {
	const located: TemplateDiagnostic[] = [], loose: TemplateDiagnostic[] = [];
	for (const diagnostic of [...found, ...runtime]) {
		(diagnostic.from !== undefined && diagnostic.from <= length ? located : loose).push(diagnostic);
	}
	located.sort((a, b) => a.from! - b.from!);
	return { located, loose };
}

/**
 * Xcode-style diagnostics. Each problem sits on its own line: the line is
 * tinted, the exact range is underlined, and a banner at the line's end gives
 * the message. Clicking the banner opens the full messages and hints in a
 * popover over the code. Nothing takes height from the editor, so the line being typed and
 * autocomplete stay where they are. `analyze` must be cheap and pure; it runs
 * again after each pause in typing.
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
			const { located, loose } = split(found, [], state.doc.length);
			return { found, runtime: [], located, loose, open: loose.length > 0, popover: null };
		},
		update(value, transaction) {
			let { found, runtime, located, loose, open, popover } = value;
			const doc = transaction.state.doc;
			if (transaction.docChanged) {
				found = found.map(diagnostic => mapDiagnostic(diagnostic, transaction.changes));
				runtime = runtime.map(diagnostic => mapDiagnostic(diagnostic, transaction.changes));
				// Typing means attention has moved back to the code.
				popover = null;
			}
			for (const effect of transaction.effects) {
				if (effect.is(setStaticDiagnostics)) found = effect.value;
				if (effect.is(setRuntimeDiagnostics)) runtime = effect.value;
				if (effect.is(closeList)) open = false;
				if (effect.is(toggleIssues)) popover = effect.value === popover ? null : effect.value;
			}
			if (found !== value.found || runtime !== value.runtime) ({ located, loose } = split(found, runtime, doc.length));
			if (loose.length) open = true;
			// A line whose problems are all fixed closes its messages.
			if (popover !== null && !located.some(diagnostic => doc.lineAt(diagnostic.from!).from === popover)) popover = null;
			return found === value.found && runtime === value.runtime && open === value.open && popover === value.popover
				? value
				: { found, runtime, located, loose, open, popover };
		},
	});

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

	const inline = EditorView.decorations.compute([field], state => {
		const { located, popover } = state.field(field);
		const ranges = [];
		const byLine = new Map<number, TemplateDiagnostic[]>();
		for (const diagnostic of located) {
			let from = diagnostic.from!, to = Math.min(diagnostic.to ?? from, state.doc.length);
			const line = state.doc.lineAt(from);
			byLine.set(line.from, [...byLine.get(line.from) ?? [], diagnostic]);
			// An empty range has nothing to underline; mark the character before it.
			if (to <= from) { if (from >= state.doc.length) from = Math.max(0, from - 1); to = Math.min(state.doc.length, from + 1); }
			if (to > from) ranges.push(Decoration.mark({ class: `cv-diagnostic-mark is-${diagnostic.severity}` }).range(from, to));
		}
		for (const [lineFrom, issues] of byLine) {
			const severity = issues.some(issue => issue.severity === "error") ? "error" : "warning";
			const open = popover === lineFrom;
			ranges.push(Decoration.line({ class: `cv-issue-line is-${severity}` }).range(lineFrom));
			// The banner floats right. Placed at the line's start, it shares the first row with
			// the code, which wraps around it instead of pushing it onto a row of its own.
			ranges.push(Decoration.widget({ widget: new IssueBanner(issues, severity, lineFrom, open), side: -1 }).range(lineFrom));
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
			const list = state.field(field).loose;
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

	const popoverTooltip = showTooltip.compute([field], (state): Tooltip | null => {
		const { located, popover: lineFrom } = state.field(field);
		if (lineFrom === null) return null;
		const issues = located.filter(diagnostic => state.doc.lineAt(diagnostic.from!).from === lineFrom);
		// The popover picks its own side in getCoords, so CodeMirror must not flip it.
		return { pos: lineFrom, above: false, strictSide: true, create: view => issuePopover(view, issues, lineFrom) };
	});

	// The popover closes on a click anywhere else, or on Escape.
	const dismiss = ViewPlugin.fromClass(class {
		constructor(private view: EditorView) {
			view.dom.ownerDocument.addEventListener("mousedown", this.onPointer, true);
		}
		onPointer = (event: MouseEvent) => {
			if (this.view.state.field(field).popover === null) return;
			const target = event.target as Element | null;
			if (target?.closest?.(".cv-issue-popover, .cv-issue-banner")) return;
			this.view.dispatch({ effects: toggleIssues.of(null) });
		};
		destroy() {
			this.view.dom.ownerDocument.removeEventListener("mousedown", this.onPointer, true);
		}
	});
	const escape = Prec.highest(keymap.of([{
		key: "Escape",
		run: view => {
			if (view.state.field(field).popover === null) return false;
			view.dispatch({ effects: toggleIssues.of(null) });
			return true;
		},
	}]));

	// In a narrow editor the banners shrink to their icons. A query on the editor's width
	// would need CSS containment, and containment clips the popover at the editor's edge.
	const narrow = ViewPlugin.fromClass(class {
		constructor(private view: EditorView) { this.measure(); }
		update(update: ViewUpdate) { if (update.geometryChanged) this.measure(); }
		measure() {
			this.view.requestMeasure({
				key: this,
				read: view => view.dom.clientWidth > 0 && view.dom.clientWidth <= NARROW_WIDTH,
				write: (isNarrow, view) => view.dom.toggleAttribute("data-cv-narrow", isNarrow),
			});
		}
	});

	return [
		field,
		scheduler,
		inline,
		narrow,
		popoverTooltip,
		dismiss,
		escape,
		showPanel.compute([field], state => state.field(field).open ? createPanel : null),
	];
}

/** Editors at most this wide show banners as icons only. */
const NARROW_WIDTH = 480;

const ICONS = { error: "circle-alert", warning: "triangle-alert" } as const;

function icon(doc: Document, severity: TemplateDiagnostic["severity"]) {
	const el = createDetachedEl(doc, "span");
	el.className = "cv-issue-icon";
	el.setAttribute("aria-hidden", "true");
	setIcon(el, ICONS[severity]);
	return el;
}

/** The banner at the end of a line: the first message, how many there are, and a way to read them all. */
class IssueBanner extends WidgetType {
	constructor(readonly issues: TemplateDiagnostic[], readonly severity: TemplateDiagnostic["severity"], readonly lineFrom: number, readonly open: boolean) { super(); }

	eq(other: IssueBanner) {
		return other.severity === this.severity && other.open === this.open && other.lineFrom === this.lineFrom
			&& other.issues.length === this.issues.length && other.issues.every((issue, i) => issue.message === this.issues[i].message);
	}

	toDOM(view: EditorView) {
		const doc = view.dom.ownerDocument;
		const banner = createDetachedEl(doc, "button");
		banner.type = "button";
		banner.className = `cv-issue-banner is-${this.severity}`;
		banner.setAttribute("aria-expanded", String(this.open));
		banner.dataset.line = String(this.lineFrom);
		banner.append(icon(doc, this.severity));
		const message = banner.appendChild(createDetachedEl(doc, "span"));
		message.className = "cv-issue-message";
		appendCode(message, this.issues[0].message);
		if (this.issues.length > 1) {
			const count = banner.appendChild(createDetachedEl(doc, "span"));
			count.className = "cv-issue-count";
			count.textContent = String(this.issues.length);
		}
		banner.addEventListener("mousedown", event => event.preventDefault());
		banner.addEventListener("click", () => view.dispatch({ effects: toggleIssues.of(this.lineFrom) }));
		return banner;
	}

	ignoreEvent() { return true; }
}

/**
 * Every message on a line, with its hint, in a popover over the code. It hangs
 * from the banner's right edge, so it reads as the banner opening up.
 */
function issuePopover(view: EditorView, issues: TemplateDiagnostic[], lineFrom: number) {
	const doc = view.dom.ownerDocument;
	const dom = createDetachedEl(doc, "div");
	dom.className = "cv-issue-popover";
	for (const issue of issues) {
		const item = dom.appendChild(createDetachedEl(doc, "div"));
		item.className = `cv-issue-detail is-${issue.severity}`;
		item.append(icon(doc, issue.severity));
		const text = item.appendChild(createDetachedEl(doc, "div"));
		text.className = "cv-issue-detail-text";
		const title = text.appendChild(createDetachedEl(doc, "button"));
		title.type = "button";
		title.className = "cv-issue-detail-title";
		appendCode(title, issue.message);
		title.addEventListener("click", () => {
			const from = Math.min(issue.from!, view.state.doc.length);
			const to = Math.min(Math.max(from, issue.to ?? from), view.state.doc.length);
			view.dispatch({ selection: { anchor: from, head: to }, effects: toggleIssues.of(null) });
			view.focus();
		});
		if (issue.hint) {
			const hint = text.appendChild(createDetachedEl(doc, "div"));
			hint.className = "cv-issue-hint";
			appendCode(hint, issue.hint);
		}
	}
	return {
		dom,
		offset: { x: 0, y: POPOVER_GAP },
		getCoords: () => {
			const banner = view.contentDOM.querySelector(`.cv-issue-banner[data-line="${lineFrom}"]`);
			if (!banner) return view.coordsAtPos(lineFrom) ?? { left: 0, right: 0, top: 0, bottom: 0 };
			const rect = banner.getBoundingClientRect();
			const editor = view.scrollDOM.getBoundingClientRect();
			const left = Math.max(editor.left, rect.right - dom.offsetWidth);
			if (!popoverGoesAbove(rect, editor, dom.offsetHeight, view.dom.ownerDocument.defaultView?.innerHeight ?? 0)) {
				return { left, right: rect.right, top: rect.top, bottom: rect.bottom };
			}
			// CodeMirror always hangs it below these coordinates, so report a point
			// one popover-height above the banner.
			const top = rect.top - dom.offsetHeight - 2 * POPOVER_GAP;
			return { left, right: rect.right, top, bottom: top };
		},
	};
}

/** Space between the banner and its popover. */
const POPOVER_GAP = 4;

/**
 * Below the banner when the popover fits inside the editor there, otherwise
 * above when it fits inside the editor there. When it fits neither way, the
 * side of the window with more room wins.
 */
export function popoverGoesAbove(banner: { top: number; bottom: number }, editor: { top: number; bottom: number }, height: number, windowHeight: number): boolean {
	const need = height + POPOVER_GAP;
	if (banner.bottom + need <= editor.bottom) return false;
	if (banner.top - need >= editor.top) return true;
	return banner.top > windowHeight - banner.bottom;
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
		setIcon(icon, ICONS[diagnostic.severity]);
		const label = title.appendChild(createDetachedEl(doc, "span"));
		const line = located ? view.state.doc.lineAt(diagnostic.from!) : undefined;
		if (line) label.append(`Line ${line.number}, column ${diagnostic.from! - line.from + 1}: `);
		appendCode(label, diagnostic.message);
		if (line && title.instanceOf(HTMLButtonElement)) {
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
