import { TFile, prepareSimpleSearch, type App } from "obsidian";
import { createDetachedEl } from "./dom";
interface Choice { name: string; type: string; file: TFile }
interface Page {
	containerEl: HTMLElement;
	searchComponent: { inputEl: HTMLInputElement };
	chooser: { setSuggestions(items: { config: Choice; group: string }[]): void };
	renderViews(): void;
	renderSuggestion(item: { config: Choice }, el: HTMLElement): void;
	onSelect(callback: (choice: Choice) => void): Page;
	onNext(callback: () => void): Page;
}
interface NativeMenu {
	query: { views: Choice[]; save(): void };
	show(page: Page): void;
	setView(name: string, icon: string): void;
	toolbarItem: {
		setOpen(open: boolean): void;
		button: { containerEl: HTMLElement; buttonEl: HTMLElement };
		menu: { mobileTitleEl: HTMLElement; bgEl: HTMLElement };
	};
}
interface Seed { controller: { viewMenu: NativeMenu; getViewConfig(): null }; unload(): void }
type Factory = (ctx: { app: App; containerEl: HTMLElement; sourcePath: string; linktext: string }, file: TFile, subpath: string) => Seed;

/** Bases' view dropdown and chooser, with files as its data source. */
export function mountNotePicker(app: App, host: HTMLElement, matches: (file: TFile) => boolean, choose: (file: TFile) => void) {
	const factory = (app as App & { embedRegistry?: { embedByExtension?: { base?: Factory } } }).embedRegistry?.embedByExtension?.base;
	if (!factory) throw new Error("Enable Bases to choose a preview note.");
	const file: unknown = Object.create(TFile.prototype);
	if (!(file instanceof TFile)) throw new Error("Could not initialize the note picker.");
	file.path = file.name = "__custom_views_picker__.base"; file.extension = "base";
	const detached = createDetachedEl(host.ownerDocument, "div");
	const seed = factory({ app, containerEl: detached, sourcePath:"",linktext:"" },file,"");
	const menu = seed.controller.viewMenu;
	let currentPage: Page | undefined;
	let choices: Choice[] = [];
	// Disable the native view-configuration context menu for this file-only control.
	seed.controller.getViewConfig = () => null;
	const refresh = () => {
		const files = app.vault.getMarkdownFiles().filter(matches);
		const counts = new Map<string,number>();
		for (const file of files) counts.set(file.basename,(counts.get(file.basename) ?? 0)+1);
		choices = files.map(file => ({ file,type:"table",name:(counts.get(file.basename) ?? 0)>1 ? `${file.basename} · ${file.parent?.path ?? "/"}` : file.basename }));
		menu.query = { views: choices, save() {} };
		currentPage?.renderViews();
	};
	const show = menu.show.bind(menu);
	menu.show = page => {
		currentPage=page;
		page.onSelect(choice => { if(matches(choice.file)) choose(choice.file); menu.toolbarItem.setOpen(false); }).onNext(()=>{});
		page.renderViews = () => {
			const search = prepareSimpleSearch(page.searchComponent.inputEl.value);
			page.chooser.setSuggestions(choices.filter(choice => search(choice.file.path)).map(config => ({config,group:"views"})));
		};
		const render = page.renderSuggestion.bind(page);
		page.renderSuggestion = (item,el) => {
			render(item,el);
			el.querySelector(".bases-toolbar-menu-item-icon")?.remove();
			el.querySelector(".bases-toolbar-menu-item-info-icon")?.remove();
		};
		refresh(); show(page);
	};
	menu.setView("Choose note","file-text");
	menu.toolbarItem.menu.mobileTitleEl.setText("Preview note");
	host.appendChild(menu.toolbarItem.button.containerEl);
	return {
		setName: (name:string) => menu.setView(name,"file-text"),
		refresh,
		dispose: () => { currentPage=undefined; menu.toolbarItem.setOpen(false); menu.toolbarItem.button.containerEl.remove(); seed.unload(); detached.remove(); },
	};
}
