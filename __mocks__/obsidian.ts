/**
 * Mock for the 'obsidian' module so tests can run outside of Obsidian.
 * Re-exports real `moment` so date filters work correctly.
 */
import momentLib from "moment";

export const moment = momentLib;

// Stub classes — tests create plain objects that satisfy the shapes they need,
// but TypeScript still needs these exports to resolve imports.
export class App {}
export class Plugin {
	app = new App();
}
export class TFile {
	path = "";
	name = "";
	basename = "";
	extension = "md";
	stat = { ctime: 0, mtime: 0, size: 0 };
	parent: { path: string } | null = null;
}
export class Component {}
export class MarkdownView {}
export class PluginSettingTab {}
export class Setting {}
export class Modal {}
export class Notice {}
export class FuzzySuggestModal {}
export class ButtonComponent {}
export class TextComponent {}
export class WorkspaceLeaf {}
export const Keymap = { isModEvent: () => false };
export function setIcon() {}
