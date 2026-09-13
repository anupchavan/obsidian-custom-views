import { createDetachedEl } from "./dom";
import { TFile, type App } from "obsidian";

export type CodeSection = "template" | "css" | "js";
export const CODE_SECTIONS: CodeSection[] = ["template", "css", "js"];
export const CODE_LABELS: Record<CodeSection, string> = { template: "HTML", css: "CSS", js: "JavaScript" };
interface NativeButton { containerEl: HTMLElement; buttonEl: HTMLElement }
type ButtonConstructor = new (host: HTMLElement, label: string, icon: string, click: () => void) => NativeButton;
interface Seed { controller: { propertyMenu: { toolbarItem: { button: NativeButton } } }; unload(): void }
type Factory = (context: { app: App; containerEl: HTMLElement; sourcePath: string; linktext: string }, file: TFile, subpath: string) => Seed;

/** Reuse Bases' text-icon button constructor, including its keyboard interactions. */
export function mountCodeButtons(app: App, host: HTMLElement, getVisible: () => CodeSection[], setVisible: (sections: CodeSection[]) => void): () => void {
	const factory = (app as App & { embedRegistry?: { embedByExtension?: { base?: Factory } } }).embedRegistry?.embedByExtension?.base;
	if (!factory) throw new Error("Enable Bases to choose code sections.");
	const file: unknown = Object.create(TFile.prototype);
	if (!(file instanceof TFile)) throw new Error("Could not initialize code controls.");
	file.path = file.name = "__custom_views_editor__.base"; file.extension = "base";
	const detached = createDetachedEl(host.ownerDocument, "div");
	const seed = factory({ app, containerEl: detached, sourcePath: "", linktext: "" }, file, "");
	const Constructor = seed.controller.propertyMenu.toolbarItem.button.constructor as ButtonConstructor;
	seed.unload();
	const buttons = new Map<CodeSection, NativeButton>();
	const refresh = () => {
		for (const [key, button] of buttons) {
			button.buttonEl.toggleClass("is-active", getVisible().includes(key));
			button.buttonEl.setAttribute("aria-pressed", String(getVisible().includes(key)));
		}
	};
	for (const key of CODE_SECTIONS) {
		const button = new Constructor(host, CODE_LABELS[key], key === "template" ? "code-xml" : key === "css" ? "paintbrush" : "braces", () => {
			const current = getVisible();
			setVisible(current.includes(key) ? current.filter(value => value !== key) : [...current, key]); refresh();
		});
		button.buttonEl.setAttribute("role", "button");
		buttons.set(key, button);
	}
	refresh();
	return () => { for (const button of buttons.values()) button.containerEl.remove(); };
}
