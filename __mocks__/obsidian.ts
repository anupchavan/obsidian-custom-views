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
	registerBasesView() { return true; }
}
export class TFile {
	path = "";
	name = "";
	basename = "";
	extension = "md";
	stat = { ctime: 0, mtime: 0, size: 0 };
	parent: { path: string } | null = null;
}
export class Component {
	load() { }
	onload() { }
	unload() { }
	onunload() { }
	addChild<T extends Component>(component: T): T { return component; }
	removeChild<T extends Component>(component: T): T { return component; }
	register() { }
}
export const MarkdownRenderer = {
	async render(_app: unknown, markdown: string, el: HTMLElement) {
		el.textContent = markdown;
	},
};
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
export class QueryController extends Component { }
export abstract class Value {
	static equals(a: Value | null, b: Value | null) { return a === b; }
	static looseEquals(a: Value | null, b: Value | null) { return a === b; }
	abstract toString(): string;
	abstract isTruthy(): boolean;
	renderTo(el: HTMLElement) { el.textContent = this.toString(); }
}
export class NullValue extends Value {
	static value = new NullValue();
	toString() { return ""; }
	isTruthy() { return false; }
}
export class ListValue extends Value {
	constructor(private values: unknown[]) { super(); }
	toString() { return this.values.map(value => value instanceof Value ? value.toString() : primitiveToString(value)).join(", "); }
	isTruthy() { return this.values.length > 0; }
	length() { return this.values.length; }
	get(index: number): Value {
		const value = this.values[index];
		if (value instanceof Value) return value;
		if (value === null || value === undefined) return NullValue.value;
		return new StringValue(primitiveToString(value));
	}
}
export class StringValue extends Value {
	constructor(private value: string) { super(); }
	toString() { return this.value; }
	isTruthy() { return this.value.length > 0; }
}
export abstract class BasesView extends Component {
	abstract type: string;
	app = new App();
	config = {
		name: "",
		get: () => null,
		getDisplayName: (propertyId: string) => propertyId,
	};
	allProperties: string[] = [];
	data = {
		data: [],
		properties: [],
	};
	protected constructor(_controller: QueryController) { super(); }
	abstract onDataUpdated(): void;
}
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
export function parsePropertyId(propertyId: string) {
	const [type, ...nameParts] = propertyId.split(".");
	if (type !== "file" && type !== "note" && type !== "formula") {
		throw new Error("Invalid property ID");
	}
	return { type, name: nameParts.join(".") };
}
export function stringifyYaml(obj: unknown) { return JSON.stringify(obj); }

function primitiveToString(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}

export function parseYaml(yaml: string) {
	if (yaml.trim() === "views: []") return { views: [] };
	return {};
}
