import { settingsGroup } from "./settings-layout";
import { Setting, type ToggleComponent } from "obsidian";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState, StateEffect } from "@codemirror/state";
import { createTemplateEditor, createTemplateEditorState, type TemplateEditorOptions, type TemplateVariable } from "./editor";
import { resolveViewContext } from "./view-context";
import type { ViewConfig, ViewContext } from "./types";

/** One set of editors; overrides are independent so CSS-only variants need no HTML copy. */
export function mountContextTemplateEditors(host: HTMLElement, view: ViewConfig, variables: TemplateVariable[], allowJS: boolean, save: () => void) {
	let context: ViewContext = "note";
	let switching = false;
	new Setting(settingsGroup(host, "Template")).setName("Template for").setDesc("Other contexts inherit the main template. Override only the languages you need.")
		.addDropdown(dropdown => dropdown.addOptions({ note: "Main note", popover: "Popover preview", canvas: "Canvas", embed: "Embedded note" })
			.onChange(value => { context = value as ViewContext; refresh(); }));
	const fields = ([['template', 'HTML', 'html'], ['css', 'CSS', 'css'], ['js', 'JavaScript', 'javascript']] as const).map(([key, label, language]) => {
		const group = settingsGroup(host, label);
		let toggle!: ToggleComponent;
		const inheritance = new Setting(group).setName(`Use main ${label}`).addToggle(control => {
			toggle = control;
			control.onChange(inherit => {
				if (switching || context === "note") return;
				const overrides = view.contexts ??= {};
				const target = overrides[context] ??= {};
				if (inherit) delete target[key];
				else target[key] = view[key] ?? "";
				refresh(); save();
			});
		});
		const container = group.createDiv({ cls: "cv-codemirror-container" });
		const readOnly = new Compartment();
		const options: TemplateEditorOptions = { initialContent: view[key] ?? "", language, templateVariables: variables, root: host.ownerDocument,
			onChange(value) {
				if (switching) return;
				if (context === "note") view[key] = value;
				else ((view.contexts ??= {})[context] ??= {})[key] = value;
				save();
			},
		};
		const editor = createTemplateEditor(options);
		editor.dispatch({ effects: StateEffect.appendConfig.of(readOnly.of([])) });
		container.appendChild(editor.dom);
		return { key, inheritance, toggle, readOnly, editor, options };
	});
	function refresh() {
		switching = true;
		try {
			const effective = resolveViewContext(view, context);
			for (const { key, inheritance, toggle, editor, readOnly, options } of fields) {
				const inherited = context !== "note" && view.contexts?.[context]?.[key] === undefined;
				inheritance.settingEl.toggle(context !== "note");
				toggle.setValue(inherited);
				editor.setState(createTemplateEditorState({ ...options, initialContent: effective[key] ?? "" }));
				editor.dispatch({ effects: StateEffect.appendConfig.of(readOnly.of([])) });
				const locked = inherited || (key === "js" && !allowJS);
				editor.dispatch({ effects: readOnly.reconfigure([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]) });
			}
		} finally { switching = false; }
	}
	refresh();
	return { templateEditor: fields[0].editor, cssEditor: fields[1].editor, jsEditor: fields[2].editor };
}
