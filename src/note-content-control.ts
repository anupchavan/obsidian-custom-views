import type { EditorView } from "@codemirror/view";
import { createDetachedEl } from "./dom";

/** Insert through CodeMirror so normal autosave, preview refresh, and undo all apply. */
export function mountNoteContentControl(container: HTMLElement, getEditor: () => EditorView | null): () => void {
	const description = createDetachedEl(container.ownerDocument, "p");
	const button = createDetachedEl(container.ownerDocument, "button");
	button.type = "button";
	button.textContent = "Add note content";
	container.append(description, button);
	const update = () => {
		const content = getEditor()?.state.doc.toString() ?? "";
		const included = /\{\{\s*(?:file\.)?content\s*(?:\|[^}]*?)?\}\}/.test(content);
		button.disabled = included;
		description.textContent = included
			? "This template includes note content. An unfiltered {{file.content}} area stays editable in live preview when editable content is enabled."
			: "This template replaces the normal note display and does not include the note body. Add note content to show it below your custom layout, or place {{file.content}} anywhere in the HTML.";
	};
	button.addEventListener("click", () => {
		const editor = getEditor();
		if (!editor || button.disabled) return;
		const end = editor.state.doc.length;
		editor.dispatch({ changes: { from: end, insert: `${end ? "\n" : ""}{{file.content}}` } });
		update();
	});
	update();
	return update;
}
