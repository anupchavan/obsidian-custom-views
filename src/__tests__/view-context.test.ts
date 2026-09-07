import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { DEFAULT_SETTINGS } from "../settings";
import { loadValidatedSettings } from "../settings-loader";
import { resolveViewContext } from "../view-context";
import { createTemplateEditor, createTemplateEditorState } from "../editor";

describe("context template inheritance", () => {
	it("inherits each language independently and preserves intentional empty overrides", () => {
		const base = { ...DEFAULT_SETTINGS.views[0], template: "Main HTML", css: "Main CSS", js: "Main JS", contexts: { popover: { css: "Small CSS", js: "" } } };
		expect(resolveViewContext(base, "popover")).toMatchObject({ template: "Main HTML", css: "Small CSS", js: "" });
		expect(resolveViewContext(base, "canvas")).toMatchObject({ template: "Main HTML", css: "Main CSS", js: "Main JS" });
		base.template = "Updated HTML";
		expect(resolveViewContext(base, "popover").template).toBe("Updated HTML");
		expect(base.css).toBe("Main CSS");
	});
	it("round-trips context settings without migrating existing templates", () => {
		const data = structuredClone(DEFAULT_SETTINGS);
		data.workInPopover = true; data.workInEmbeds = true;
		data.views[0].contexts = { popover: { template: "", js: "" }, canvas: { css: ".small {}" } };
		expect(loadValidatedSettings(data)).toEqual({ settings: data, recovered: false });
	});
	it.each([{ popover: { js: 12 } }, { popover: null }, { unknown: {} }, { canvas: { enabled: true } }])("preserves invalid overrides in recovery: %j", contexts => {
		const data = { views: [{ ...DEFAULT_SETTINGS.views[0], contexts }] };
		const result = loadValidatedSettings(data);
		expect(result.recovered).toBe(true);
		expect(result.settings.views).toEqual([]);
		expect(result.settings.recoveryData).toEqual(data);
	});
	it("cannot undo edits from another context into the current template", () => {
		const editor: EditorView = createTemplateEditor({ initialContent: "Main HTML" });
		try {
			editor.dispatch({ changes: { from: 0, insert: "Edit " } });
			editor.setState(createTemplateEditorState({ initialContent: "Popover HTML" }));
			expect(undo(editor)).toBe(false);
			expect(editor.state.doc.toString()).toBe("Popover HTML");
		} finally { editor.destroy(); }
	});
});
