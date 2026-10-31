import { afterEach, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { completionAppearance } from "../editor-completions";

afterEach(() => vi.restoreAllMocks());

it("uses host icons for template and language suggestions without replacing labels", () => {
	const setIcon = vi.spyOn(obsidian, "setIcon");
	const view = new EditorView({ state: EditorState.create({ doc: "" }) });
	try {
		for (const [type, expected] of [["cv-number", "binary"], ["function", "square-function"], ["keyword", "code"], ["new-type", "code"]]) {
			const node = completionAppearance.addToOptions![0].render({ label: "value", type }, view.state, view) as HTMLElement;
			expect(setIcon).toHaveBeenLastCalledWith(node.firstElementChild, expected);
			expect(node.getAttribute("aria-hidden")).toBe("true");
			expect(node.textContent).toBe("");
			expect(node.ownerDocument).toBe(view.dom.ownerDocument);
		}
	} finally { view.destroy(); }
});

it("shows the detail the way Obsidian does, since its CSS hides CodeMirror's own", () => {
	const view = new EditorView({ state: EditorState.create({ doc: "" }) });
	try {
		const render = completionAppearance.addToOptions![1].render;
		const node = render({ label: "upper", detail: "UPPERCASE" }, view.state, view) as HTMLElement;
		expect(node.className).toBe("suggestion-aux");
		expect(node.firstElementChild?.className).toBe("suggestion-flair u-small");
		expect(node.textContent).toBe("UPPERCASE");
		expect(render({ label: "plain" }, view.state, view)).toBeNull();
	} finally { view.destroy(); }
});
