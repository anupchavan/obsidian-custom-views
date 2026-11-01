import { setIcon } from "obsidian";
import type { autocompletion } from "@codemirror/autocomplete";
import { createDetachedEl } from "./dom";

const icons: Record<string, string> = {
	"cv-text": "text", "cv-number": "binary", "cv-date": "calendar",
	"cv-datetime": "clock", "cv-list": "list", "cv-checkbox": "check-square",
	"cv-file": "file", function: "square-function", method: "square-function",
	keyword: "code", type: "braces", class: "braces", namespace: "braces",
	variable: "variable", property: "text", constant: "diamond", enum: "list",
	text: "text",
};

/** Keep CodeMirror's matching, label rendering, selection, and accessibility. */
export const completionAppearance: NonNullable<Parameters<typeof autocompletion>[0]> = {
	icons: false,
	tooltipClass: () => "cv-editor-completions",
	optionClass: () => "suggestion-item mod-complex",
	addToOptions: [{
		position: 20,
		render(completion, _state, view) {
			const icon = createDetachedEl(view.dom.ownerDocument, "span");
			icon.className = "suggestion-icon";
			icon.setAttribute("aria-hidden", "true");
			const flair = icon.createSpan({ cls: "suggestion-flair" });
			setIcon(flair, icons[completion.type?.split(" ")[0] ?? ""] ?? "code");
			return icon;
		},
	}],
};
