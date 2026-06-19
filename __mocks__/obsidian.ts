/**
 * Mock for the 'obsidian' module so tests can run outside of Obsidian.
 * Re-exports real `moment` so date filters work correctly.
 *
 * The moment import below is intentional — this file IS the obsidian mock,
 * so we must source moment directly rather than from 'obsidian' itself.
 */
// eslint-disable-next-line no-restricted-imports
import momentLib from "moment";

export const moment = momentLib;

// Stub classes — tests create plain objects that satisfy the shapes they need,
// but TypeScript still needs these exports to resolve imports.
export class App { }
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
export class Component { }
export class MarkdownView { }
export class PluginSettingTab { }
export class Setting { }
export class Modal { }
export class Notice { }
export class FuzzySuggestModal { }
export class AbstractInputSuggest {
	constructor(_app: unknown, _inputEl: unknown) { }
	limit = 100;
	close() { }
	onSelect(_callback: unknown) { return this; }
}
export class TFolder {
	path = "";
	name = "";
	children: unknown[] = [];
	isRoot() { return false; }
	parent: { path: string } | null = null;
}
export class TAbstractFile {
	path = "";
	name = "";
	parent: { path: string } | null = null;
}
export class ButtonComponent { }
export class TextComponent { }
export class WorkspaceLeaf { }
export class Menu {
	static forEvent(_evt: unknown) { return new Menu(); }
	addItem() { return this; }
	addSeparator() { return this; }
	showAtMouseEvent() { return this; }
	showAtPosition() { return this; }
}
export const Keymap = { isModEvent: () => false };
export function setIcon() { }
export function getAllTags() { return []; }
export function prepareFuzzySearch() { return () => null; }
export function renderResults() { }
