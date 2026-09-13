import { expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
vi.mock("obsidian", async importOriginal => ({
 ...await importOriginal<typeof import("obsidian")>(),
 Setting: class {
  settingEl: HTMLElement;
  controlEl: HTMLElement;
  constructor(host: HTMLElement) {
   this.settingEl = host.appendChild(document.createElement("div"));
   this.controlEl = this.settingEl.appendChild(document.createElement("div"));
  }
  setName(name: string) { this.settingEl.append(name); return this; }
  setHeading() { return this; }
  setClass(name: string) { this.settingEl.classList.add(name); return this; }
  addExtraButton(callback: (button: unknown) => void) {
   const button = { setIcon: () => button, setTooltip: () => button, setDisabled: () => button, onClick: () => button };
   callback(button); return this;
  }
 },
}));
import { EditorWorkbench } from "../view-editor-workbench";

function container(): HTMLDivElement {
 const host = document.createElement("div");
 host.empty = () => host.replaceChildren();
 host.createDiv = () => { const child = container(); host.append(child); return child; };
 return host;
}
it("shares one metadata lookup across the three language editors per rebuild", () => {
 const getAllProperties = vi.fn(() => ({ title: { name: "title", widget: "text" } }));
 const editors = new Map<string, { editor: EditorView }>();
 const editor = Object.assign(Object.create(EditorWorkbench.prototype), {
  plugin: { app: { metadataTypeManager: { getAllProperties } }, settings: { allowJavaScript: false } },
  panels: container(), code: container(), editors, view: { template: "<p>Text</p>", css: "p {}", js: "" },
  context: "note", layoutPanels: vi.fn(), state: { order: ["template", "css", "js"], visible: ["template", "css", "js"] },
 });
 try {
  editor.buildEditors();
  expect(editors.size).toBe(3); expect(getAllProperties).toHaveBeenCalledOnce();
  expect(editors.get("template")?.editor.state.doc.toString()).toBe("<p>Text</p>");
  editor.buildEditors(); expect(getAllProperties).toHaveBeenCalledTimes(2);
 } finally { for (const { editor } of editors.values()) editor.destroy(); }
});
