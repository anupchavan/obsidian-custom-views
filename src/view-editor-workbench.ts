import { ExtraButtonComponent, Platform, TFile, Setting, Notice, Component, type WorkspaceLeaf } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { mountNotePicker } from "./view-editor-note-picker";
import { openCodePopout } from "./view-editor-popout";
import type CustomViewsPlugin from "./main";
import { createTemplateEditor } from "./editor";
import { getVaultTemplateProperties } from "./template-properties";
import { resolveViewContext } from "./view-context";
import { mountNativeFilters } from "./native-filters/editor";
import { CODE_LABELS, CODE_SECTIONS, mountCodeButtons, type CodeSection } from "./view-editor-native";
import { cancelPanelDrag, labelPreviewContexts, panelOrderMenu, reorderHandle, splitter } from "./view-editor-layout";
import { EditorPreview } from "./view-editor-preview";
import type { ViewConfig, ViewContext } from "./types";

export type Dock = "left" | "right" | "top" | "bottom";
export function responsiveDock(dock: Dock, width: number): Dock {
	return width > 0 && width < 600 && (dock === "left" || dock === "right") ? "bottom" : dock;
}
export function horizontalCodePanels(width: number, height: number): boolean {
	return width >= 600 && width > height * 1.2;
}
export interface WorkbenchState { dock: Dock; ratio: number; order: CodeSection[]; visible: CodeSection[]; weights: Record<CodeSection, number>; notePath: string }
export function normalizeWorkbench(value: unknown = {}): WorkbenchState {
	const state: Partial<WorkbenchState> = value && typeof value === "object" ? value : {};
	const order = Array.isArray(state.order) ? CODE_SECTIONS.filter(key => state.order!.includes(key)).sort((a,b) => state.order!.indexOf(a)-state.order!.indexOf(b)) : [];
	return { dock: ["left","right","top","bottom"].includes(state.dock ?? "") ? state.dock! : "right", ratio: Number.isFinite(state.ratio) ? Math.max(.1,Math.min(.9,state.ratio!)) : .5,
		order: [...order,...CODE_SECTIONS.filter(key => !order.includes(key))], visible: Array.isArray(state.visible) ? CODE_SECTIONS.filter(key => state.visible!.includes(key)) : [...CODE_SECTIONS],
		weights: Object.fromEntries(CODE_SECTIONS.map(key => [key, Math.max(.05, Math.min(.9,Number(state.weights?.[key]) || 1/3))])) as Record<CodeSection,number>, notePath: typeof state.notePath === "string" ? state.notePath : "" };
}

export class EditorWorkbench {
	private root: HTMLElement;
	private code: HTMLElement;
	private panels: HTMLElement;
	private previewPane: HTMLElement;
	private previewHost: HTMLElement;
	private preview: EditorPreview;
	private editors = new Map<CodeSection, { editor: EditorView; element: HTMLElement }>();
	private disposeControls: (() => void)[] = [];
	private observer: ResizeObserver;
	private horizontal = false;
	private effectiveDock: Dock = "right";
	private saveTimer?: number;
	private previewTimer?: number;
	private runRequested = false;
	private closed = false;
	private note?: TFile;
	private notePicker?: ReturnType<typeof mountNotePicker>;
	private dirty = false;
	private touched = false;
	private applyingRemote = false;
	private lifecycle = new Component();
	private rulesSnapshot = "";
	private filterHost: HTMLElement;
	private unmountRules?: () => void;
	private closePopout?: () => void;
	private undocked = false;
	constructor(private plugin: CustomViewsPlugin, private host: HTMLElement, private view: ViewConfig, private context: ViewContext, readonly state: WorkbenchState, private changed: () => void, leaf?: WorkspaceLeaf) {
		host.empty(); host.addClass("cv-editor-workbench");
		this.root = host.createDiv("cv-editor-layout");
		this.code = this.root.createDiv("cv-editor-code");
		const codeToolbar = this.code.createDiv("cv-editor-toolbar");

		try { this.disposeControls.push(mountCodeButtons(plugin.app, codeToolbar, () => this.state.visible, visible => { this.state.visible = visible; this.layoutPanels(); this.changed(); })); }
		catch (error) { codeToolbar.createSpan({text: error instanceof Error ? error.message : "Code controls unavailable.", attr:{role:"alert"}}); }
		this.panels = this.code.createDiv("cv-editor-panels");
		this.previewPane = this.root.createDiv("cv-editor-preview-pane");
		const toolbar = this.previewPane.createDiv("cv-editor-toolbar");
		const noteHost = toolbar.createDiv("cv-editor-note");
		try {
			this.notePicker = mountNotePicker(plugin.app,noteHost,file=>this.matches(file),file=>this.chooseNote(file));
			this.disposeControls.push(()=>this.notePicker?.dispose());
		} catch(error) { noteHost.createSpan({text:String(error),attr:{role:"alert"}}); }
		const contexts = toolbar.createDiv("cv-editor-contexts");
		labelPreviewContexts(contexts);
		const contextButtons = new Map<ViewContext, ExtraButtonComponent>();
		const updateContexts = () => {
			for (const [key,button] of contextButtons) {
				button.extraSettingsEl.toggleClass("is-active", key === this.context);
				button.extraSettingsEl.setAttribute("aria-pressed", String(key === this.context));
			}
		};
		for (const [key,label,icon] of [["note","Main note","file-text"],["popover","Popover preview","scan-eye"],["canvas","Canvas","layout-dashboard"],["embed","Embedded note","file-symlink"]] as const) {
			contextButtons.set(key,new ExtraButtonComponent(contexts).setIcon(icon).setTooltip(label).onClick(() => {
				if(this.context === key) return;
				this.context = key; updateContexts(); this.buildEditors(); this.requestPreview(); this.changed();
			}));
		}
		updateContexts();
		this.filterHost=toolbar.createDiv("cv-editor-filter");
		this.mountRules();
		this.disposeControls.push(()=>this.unmountRules?.());
		this.previewHost = this.previewPane.createDiv("cv-editor-preview");
		this.preview = new EditorPreview(plugin.app, this.previewHost, plugin.editorBasesProvider, leaf);
		this.buildEditors();
		this.lifecycle.load();
		this.lifecycle.registerEvent(plugin.settingsEvents.on("changed",()=>this.syncEditors()));
		this.rulesSnapshot=JSON.stringify([view.rules,view.basesFilters]);
		this.layout();
		this.observer = new ResizeObserver(entries => {
			for (const entry of entries) {
				if (entry.target === this.root) {
					if (!this.undocked && (responsiveDock(this.state.dock, entry.contentRect.width) !== this.effectiveDock || this.root.dataset.compact !== String(entry.contentRect.width > 0 && entry.contentRect.width < 600))) this.layout();
				} else {
					const horizontal = horizontalCodePanels(entry.contentRect.width, entry.contentRect.height);
					if (horizontal !== this.horizontal) { this.horizontal = horizontal; this.layoutPanels(); }
				}
			}
		});
		this.observer.observe(this.panels);
		this.observer.observe(this.root);
		this.lifecycle.registerEvent(plugin.app.vault.on("modify", file => { if(file === this.note) this.requestPreview(); }));
		this.lifecycle.registerEvent(plugin.app.vault.on("rename", file => { if(file === this.note && file instanceof TFile) this.chooseNote(file); }));
		this.lifecycle.registerEvent(plugin.app.vault.on("delete", file => {
			if(file !== this.note) return;
			this.note = undefined; this.state.notePath = ""; this.preview.clear();
			this.notePicker?.setName("Choose note"); new Notice("The preview note was deleted. Choose another note."); this.changed();
		}));
		this.lifecycle.registerEvent(plugin.app.metadataCache.on("changed", file => { if(file === this.note) { this.refreshNotes(false); this.requestPreview(); } }));
		this.lifecycle.registerEvent(plugin.app.workspace.on("css-change", () => this.preview.refreshTheme()));
		const file = plugin.app.vault.getAbstractFileByPath(state.notePath);
		if (file instanceof TFile && file.extension === "md" && this.matches(file)) this.chooseNote(file);
		else this.previewHost.createDiv({cls:"cv-editor-empty",text:"Choose a note to preview this view."});
	}
	getContext() { return this.context; }
	setDock(dock: Dock) { this.closePopout?.(); this.closePopout = undefined; this.undocked=false; this.state.dock = dock; this.layout(); this.changed(); }
	isUndocked() { return this.undocked; }
	async undock() {
		if (this.undocked || this.closed) return;
		this.undocked=true;
		try {
			const close = await openCodePopout(this.plugin, { name:this.view.name,
				attach:host => {
					host.addClass("cv-editor-workbench"); host.appendChild(this.code);
					this.root.querySelector(":scope > .cv-editor-splitter")?.remove();
					this.root.addClass("cv-code-undocked"); this.code.addClass("cv-code-undocked");
					for(const {editor} of this.editors.values()) editor.setRoot(host.ownerDocument);
				},
				detach:() => {
					this.undocked=false; this.closePopout=undefined;
					this.root.removeClass("cv-code-undocked"); this.code.removeClass("cv-code-undocked");
					if(!this.closed) { this.layout(); for(const {editor} of this.editors.values()) editor.setRoot(this.host.ownerDocument); }
				},
			});
			if(this.closed || !this.undocked) close(); else this.closePopout=close;
		} catch(error) { this.undocked=false; if(!this.closed){this.layout();new Notice(String(error));} }
	}
	private layout() {
		this.effectiveDock = responsiveDock(this.state.dock, this.root.clientWidth);
		this.root.dataset.dock = this.effectiveDock;
		this.root.dataset.compact = String(this.root.clientWidth > 0 && this.root.clientWidth < 600);
		this.root.querySelector(":scope > .cv-editor-splitter")?.remove();
		const reverse = this.effectiveDock === "right" || this.effectiveDock === "bottom";
		splitter(this.root, () => ["left","right"].includes(this.effectiveDock) ? "x":"y", () => reverse ? 1-this.state.ratio : this.state.ratio,
			value => { this.state.ratio = reverse ? 1-value : value; this.size(); }, this.changed, "Resize code and preview");
		// Reorder with CSS: removing a live iframe would destroy its browsing context.
		if (this.code.parentElement !== this.root) this.root.appendChild(this.code);
		this.size();
	}
	private size() { this.code.style.flex = `${this.state.ratio} 1 0`; this.previewPane.style.flex = `${1-this.state.ratio} 1 0`; }
	private buildEditors() {
		cancelPanelDrag(this.plugin.app,this);
		for (const {editor} of this.editors.values()) editor.destroy();
		this.editors.clear(); this.panels.empty();
		const effective = resolveViewContext(this.view, this.context);
		const templateVariables = getVaultTemplateProperties(this.plugin.app);
		for (const key of CODE_SECTIONS) {
			const element = this.panels.createDiv("cv-editor-section");
			const header = new Setting(element).setName(CODE_LABELS[key]).setHeading().setClass("cv-editor-section-heading");
			const heading = header.settingEl;
			if (key === "js") header.addExtraButton(button => button.setIcon("play").setTooltip("Run JavaScript").setDisabled(!this.plugin.settings.allowJavaScript).onClick(() => this.requestPreview(true)));
			if (this.context !== "note") new ExtraButtonComponent(header.controlEl).setIcon("rotate-ccw").setTooltip(`Use main ${CODE_LABELS[key]}`).onClick(() => {
				delete this.view.contexts?.[this.context as Exclude<ViewContext,"note">]?.[key]; this.buildEditors(); this.requestSave(); this.requestPreview();
			});
			const move = (from: CodeSection, to: CodeSection) => {
				const order = this.state.order, target = order.indexOf(to); order.splice(order.indexOf(from),1); order.splice(target,0,from); this.layoutPanels(); this.changed(); heading.focus();
			};
			reorderHandle(this.plugin.app,this,heading,key,() => this.state.order.filter(key=>this.state.visible.includes(key)).map(key=>({key,element:this.editors.get(key)!.element})),move);
			if (Platform.isMobile) header.addExtraButton(button => button.setIcon("arrow-up-down").setTooltip(`Reorder ${CODE_LABELS[key]}`).onClick(() => {
				const rect = button.extraSettingsEl.getBoundingClientRect();
				panelOrderMenu(key, this.state.order.filter(key => this.state.visible.includes(key)), move).showAtPosition({ x: rect.left, y: rect.bottom }, heading.ownerDocument);
			}));
			const container = element.createDiv("cv-codemirror-container");
			const editor = createTemplateEditor({initialContent:effective[key] ?? "",language:key === "template" ? "html":key === "css" ? "css":"javascript",root:this.code.ownerDocument,templateVariables,onChange:value=>{
				if(this.applyingRemote) return;
				if (this.context === "note") this.view[key]=value;
				else ((this.view.contexts ??= {})[this.context] ??= {})[key]=value;
				this.requestSave(); if (key !== "js") this.requestPreview();
			}});
			container.appendChild(editor.dom); this.editors.set(key,{editor,element});
		}
		this.layoutPanels();
	}
	private layoutPanels() {
		this.panels.dataset.orientation = this.horizontal ? "horizontal":"vertical";
		this.panels.querySelectorAll(":scope > .cv-editor-splitter").forEach(el=>el.remove());
		const visible = this.state.order.filter(key=>this.state.visible.includes(key));
		for (const [key,{element}] of this.editors) { element.hidden=!visible.includes(key); this.panels.appendChild(element); }
		for (let i=0;i<visible.length;i++) {
			const key=visible[i], section=this.editors.get(key)!;
			this.panels.appendChild(section.element);
			if (i < visible.length-1) {
				const next=visible[i+1];
				splitter(this.panels,()=>this.horizontal?"x":"y",()=>this.state.weights[key] / this.visibleWeight(),value=>{
					const sum=this.state.weights[key]+this.state.weights[next];
					this.state.weights[key]=Math.max(.05,Math.min(sum-.05,value * this.visibleWeight())); this.state.weights[next]=sum-this.state.weights[key]; this.sizePanels();
				},this.changed,`Resize ${CODE_LABELS[key]} and ${CODE_LABELS[next]}`);
			}
		}
		this.sizePanels();
	}
	private visibleWeight() { return this.state.visible.reduce((sum,key)=>sum+this.state.weights[key],0) || 1; }
	private sizePanels() { for (const [key,{element,editor}] of this.editors) {element.style.flex=`${this.state.weights[key] * 100} 1 0`; editor.requestMeasure();} }
	private matches(file:TFile) { return this.plugin.nativeRules.matches({...this.view,enabled:true},file,this.plugin.app.metadataCache.getFileCache(file)?.frontmatter); }
	private refreshNotes(refreshPicker = true) {
		if (refreshPicker) this.notePicker?.refresh();
		if(this.note && !this.matches(this.note)) {
			this.note=undefined; this.state.notePath=""; this.preview.clear(); this.notePicker?.setName("Choose note");
			new Notice("Choose a note that matches these rules."); this.changed();
		}
	}
	private chooseNote(file:TFile) { this.note=file; this.state.notePath=file.path; this.notePicker?.setName(file.basename); this.changed(); this.requestPreview(true); }
	private mountRules() {
		this.unmountRules?.();this.filterHost.empty();
		this.unmountRules=mountNativeFilters(this.plugin.app,this.filterHost,this.view,()=>{
			this.rulesSnapshot=JSON.stringify([this.view.rules,this.view.basesFilters]);
			this.requestSave();this.refreshNotes();
		},true);
	}
	private syncEditors() {
		if(this.closed) return;
		const latest=this.plugin.settings.views.find(view=>view.id===this.view.id);
		if(!latest) {
			this.dirty = false;
			this.dispose();
			this.host.createDiv({ cls: "cv-editor-empty", text: "This view was deleted. Open another view to continue.", attr: { role: "status" } });
			return;
		}
		const replaced=this.view!==latest;
		this.view=latest;
		const effective=resolveViewContext(latest,this.context);
		let previewChanged=false;
		this.applyingRemote=true;
		try {
			for(const [key,{editor}] of this.editors) {
				const before=editor.state.doc.toString(),after=effective[key] ?? "";
				if(before===after) continue;
				let from=0,end=0;
				while(from<before.length && from<after.length && before[from]===after[from]) from++;
				while(end<before.length-from && end<after.length-from && before[before.length-1-end]===after[after.length-1-end]) end++;
				editor.dispatch({changes:{from,to:before.length-end,insert:after.slice(from,after.length-end)}});
				if(key!=="js")previewChanged=true;
			}
		} finally {this.applyingRemote=false;}
		const rules=JSON.stringify([latest.rules,latest.basesFilters]);
		if(replaced || rules!==this.rulesSnapshot){this.rulesSnapshot=rules;this.mountRules();this.refreshNotes();previewChanged=true;}
		if(previewChanged)this.requestPreview();
	}

	private requestSave() {
		this.dirty=true; this.touched=true;
		this.host.win.clearTimeout(this.saveTimer);
		this.saveTimer=this.host.win.setTimeout(()=> {void this.save();},400);
	}
	private async save() {
		if (!this.dirty) return;
		this.dirty=false;
		try { await this.plugin.saveSettings(); }
		catch { this.dirty=true; if(!this.closed) new Notice("Could not save. Your edits are still open."); }
	}
	private requestPreview(run=false) {
		this.runRequested ||= run;
		this.host.win.clearTimeout(this.previewTimer);
		this.previewTimer=this.host.win.setTimeout(()=>{
			const run = this.runRequested;
			this.runRequested = false;
			if(this.closed || !this.note) return;
			void this.preview.render(this.note,resolveViewContext(this.view,this.context),run && this.plugin.settings.allowJavaScript,this.context).catch(error=>{if(!this.closed)new Notice(String(error));});
		},this.runRequested?0:250);
	}
	dispose() {
		if (this.closed) return;
		cancelPanelDrag(this.plugin.app,this);
		this.closed=true; this.lifecycle.unload(); this.closePopout?.(); this.closePopout=undefined; this.observer.disconnect();
		this.host.win.clearTimeout(this.saveTimer); this.host.win.clearTimeout(this.previewTimer);
		void this.save(); this.preview.clear();
		for(const dispose of this.disposeControls) dispose();
		for(const {editor} of this.editors.values()) editor.destroy();
		this.editors.clear(); this.host.empty();
		if (this.touched) this.plugin.refreshAllViews();
	}
}
