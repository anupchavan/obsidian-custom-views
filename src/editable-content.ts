import {
	StateField,
	RangeSet,
	RangeSetBuilder,
	type Extension,
	type Transaction,
} from "@codemirror/state";
import {
	EditorView,
	Decoration,
	type DecorationSet,
	WidgetType,
} from "@codemirror/view";

// Frontmatter detection

/**
 * Detects the frontmatter range in a CM6 document.
 * Returns the character range covering from the start of the document through
 * the closing `---` delimiter (including its trailing newline), or null if
 * no valid frontmatter is found.
 */
export function detectFrontmatterRange(
	doc: { lines: number; line(n: number): { text: string; from: number; to: number } }
): { from: number; to: number } | null {
	if (doc.lines < 2) return null;

	const firstLine = doc.line(1);
	if (firstLine.text.trim() !== "---") return null;

	for (let i = 2; i <= doc.lines; i++) {
		const line = doc.line(i);
		if (line.text.trim() === "---") {
			// Include the trailing newline if there is one
			const to = i < doc.lines ? line.to + 1 : line.to;
			return { from: 0, to };
		}
	}

	// Unclosed frontmatter — not valid
	return null;
}

// Zero-height widget

/**
 * A block widget that renders as a zero-height element.
 * Used to replace the frontmatter region so it occupies no vertical space.
 */
class ZeroHeightWidget extends WidgetType {
	toDOM(): HTMLElement {
		const el = activeDocument.createElement("div");
		el.className = "cv-frontmatter-hidden";
		return el;
	}

	eq(): boolean {
		return true;
	}
}

// StateField: Frontmatter hide decorations

function buildFrontmatterDecorations(doc: { lines: number; line(n: number): { text: string; from: number; to: number } }): DecorationSet {
	const range = detectFrontmatterRange(doc);
	if (!range) return Decoration.none;

	const builder = new RangeSetBuilder<Decoration>();
	builder.add(
		range.from,
		range.to,
		Decoration.replace({ widget: new ZeroHeightWidget(), block: true })
	);
	return builder.finish();
}

/**
 * StateField that provides block-replace decorations to hide the frontmatter.
 * Must be provided from a StateField (not ViewPlugin) because the decoration
 * affects vertical layout.
 */
export const frontmatterHideField: StateField<DecorationSet> = StateField.define<DecorationSet>({
	create(state) {
		return buildFrontmatterDecorations(state.doc);
	},
	update(value: DecorationSet, tr: Transaction) {
		if (!tr.docChanged) return value;
		return buildFrontmatterDecorations(tr.newDoc);
	},
	provide(field) {
		return EditorView.decorations.from(field);
	},
});

// Atomic ranges

/**
 * Marks the frontmatter range as atomic so the cursor skips over it
 * rather than entering the hidden region character by character.
 */
export const frontmatterAtomicRanges = EditorView.atomicRanges.of((view) => {
	const range = detectFrontmatterRange(view.state.doc);
	if (!range) return RangeSet.empty;

	const builder = new RangeSetBuilder<Decoration>();
	builder.add(range.from, range.to, Decoration.mark({}));
	return builder.finish();
});

// Editor CSS theme

/**
 * Theme overrides for the editor when embedded inside a template placeholder.
 * Removes own scrollbar so the template container handles scrolling.
 */
export const editableContentTheme = EditorView.theme({
	"&": {
		height: "auto !important",
		maxHeight: "none !important",
	},
	".cm-scroller": {
		overflow: "visible !important",
	},
});

// Combined extension

/**
 * Returns the full set of CM6 extensions needed for editable content mode.
 */
export function createEditableContentExtensions(): Extension[] {
	return [
		frontmatterHideField,
		frontmatterAtomicRanges,
		editableContentTheme,
	];
}
