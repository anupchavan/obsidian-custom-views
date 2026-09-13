import { registerPreviewWindow } from "./view-editor-window";
import { mountPreviewSurface } from "./view-editor-surfaces";
import { capturePreview, patchPreview, type PreviewTree } from "./view-editor-patch";
import { createDetachedEl } from "./dom";
import { Component, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import { renderTemplate } from "./renderer";
import type { BasesDataProvider } from "./bases/types";
import type { ViewConfig, ViewContext } from "./types";

/** Keep the browsing context alive during live edits; explicit runs restart script state. */
class PreviewSession {
	private frame?: HTMLIFrameElement;
	private component?: Component;
	private abort?: AbortController;
	private generation = 0;
	private themeProperties: string[] = [];
	private tree?: PreviewTree;
	private filePath?: string;
	private context: ViewContext = "note";
	private surface?: ReturnType<typeof mountPreviewSurface>;
	private patches: { component: Component; nodes: Node[] }[] = [];
	constructor(private app: App, private host: HTMLElement, private basesProvider?: BasesDataProvider, private leaf?: WorkspaceLeaf) {}
	async render(file: TFile, config: ViewConfig, runJavaScript: boolean, context: ViewContext = "note") {
		if (this.frame && this.tree && this.filePath === file.path && this.context === context && !runJavaScript) {
			await this.update(file, config);
			return;
		}
		this.clear();
		this.filePath = file.path;
		this.context = context;
		this.surface = mountPreviewSurface(this.app,this.host,file,context,this.leaf);
		const generation = this.generation;
		const abort = this.abort = new AbortController();
		const frame = this.frame = createDetachedEl(this.host.ownerDocument,"iframe");
		frame.className = "cv-editor-preview-frame"; frame.title = `Preview: ${file.basename}`;
		this.surface.container.appendChild(frame);
		const doc = frame.contentDocument;
		if (!doc) throw new Error("Could not create the preview document.");
		this.refreshTheme();
		const layout = createDetachedEl(doc, "style");
		layout.textContent = "html, body { height:100%; margin:0; overflow:auto; display:block; } [data-cv-id=cv-editor-preview] { min-height:100%; }";
		doc.head.appendChild(layout);
		const root = createDetachedEl(doc, "div");
		root.setAttribute("data-cv-id", "cv-editor-preview");
		doc.body.appendChild(root);
		const content = createDetachedEl(doc, "div");
		content.className = "obsidian-custom-view-render";
		root.appendChild(content);
		const component = this.component = new Component();
		component.load();
		registerPreviewWindow(frame, component, this.app);
		root.addEventListener("click", event => {
			const link = (event.target as Element).closest<HTMLAnchorElement>("a.internal-link");
			if (link) { event.preventDefault(); void this.app.workspace.openLinkText(link.dataset.href ?? link.getAttribute("href") ?? "", file.path, true); }
		});
		try {
			await renderTemplate(this.app, config.template, file, content, component, false, config, "cv-editor-preview", runJavaScript, undefined, this.basesProvider, abort.signal, () => { this.tree = capturePreview(content); });
		} catch (error) {
			if (abort.signal.aborted || generation !== this.generation) return;
			content.setText(error instanceof Error ? error.message : "Could not render preview.");
			content.setAttribute("role", "alert");
		}
	}
	getFrame() { return this.frame; }
	matches(file: TFile, context: ViewContext) { return this.filePath === file.path && this.context === context; }
	refreshTheme() {
		const doc = this.frame?.contentDocument;
		if (!doc) return;
		const source = this.host.ownerDocument;
		doc.head.querySelectorAll("[data-cv-host-theme]").forEach(el => el.remove());
		for (const style of Array.from(source.querySelectorAll('head style, head link[rel="stylesheet"]')).reverse()) {
			const clone = style.cloneNode(true) as Element;
			clone.setAttribute("data-cv-host-theme", "");
			doc.head.prepend(clone);
		}
		doc.body.className = source.body.className;
		const theme = source.defaultView!.getComputedStyle(this.host);
		for (const property of this.themeProperties) doc.body.style.removeProperty(property);
		this.themeProperties = Array.from(theme).filter(property => property.startsWith("--"));
		for (const property of this.themeProperties) doc.body.style.setProperty(property, theme.getPropertyValue(property));
	}

	private async update(file: TFile, config: ViewConfig) {
		this.abort?.abort();
		const abort = this.abort = new AbortController();
		const generation = ++this.generation;
		const doc = this.frame!.contentDocument!;
		const staged = createDetachedEl(doc, "div");
		staged.className = "obsidian-custom-view-render";
		const component = new Component(); component.load();
		try {
			await renderTemplate(this.app, config.template, file, staged, component, false, config, "cv-editor-preview", false, undefined, this.basesProvider, abort.signal);
			if (abort.signal.aborted || generation !== this.generation) { component.unload(); return; }
			const scroll = [doc.documentElement, doc.body, ...Array.from(doc.body.querySelectorAll<HTMLElement>("*"))]
				.filter(el => el.scrollTop || el.scrollLeft).map(el => ({el,top:el.scrollTop,left:el.scrollLeft}));
			const nodes = Array.from(staged.querySelectorAll("*"));
			this.tree = patchPreview(this.tree!, staged);
			for (const {el,top,left} of scroll) { el.scrollTop = top; el.scrollLeft = left; }
			this.patches.push({component,nodes});
			this.patches = this.patches.filter(patch => {
				if (patch.nodes.some(node => node.isConnected)) return true;
				patch.component.unload(); return false;
			});
		} catch (error) {
			component.unload();
			if (!abort.signal.aborted && generation === this.generation) throw error;
		} finally {
			(staged as HTMLElement & {__cvScopeObserver?: MutationObserver}).__cvScopeObserver?.disconnect();
		}
	}

	clear() {
		this.generation++;
		this.tree = undefined; this.filePath = undefined;
		for (const patch of this.patches) patch.component.unload();
		this.patches = [];
		this.abort?.abort(); this.abort = undefined;
		this.component?.unload(); this.component = undefined;
		const content = this.frame?.contentDocument?.querySelector(".obsidian-custom-view-render") as (HTMLElement & { __cvScopeObserver?: MutationObserver }) | null;
		content?.__cvScopeObserver?.disconnect();
		this.frame?.remove(); this.frame = undefined;
		this.surface?.dispose(); this.surface = undefined;
		this.host.replaceChildren();
	}
}

/** Prepare note switches at their final size while the previous preview stays visible. */
export class EditorPreview {
 private current?: {session: PreviewSession; layer: HTMLElement};
 private pending?: {session: PreviewSession; layer: HTMLElement; run: boolean};
 private cancelImageWait?: () => void;
 private generation = 0;
 constructor(private app: App, private host: HTMLElement, private basesProvider?: BasesDataProvider, private leaf?: WorkspaceLeaf) {}
 get frame() { return this.current?.session.getFrame(); }
 async render(file: TFile, config: ViewConfig, run: boolean, context: ViewContext = "note") {
  const generation = ++this.generation;
  run ||= !!this.pending?.run && this.pending.session.matches(file,context);
  this.cancelImageWait?.();
  this.dispose(this.pending); this.pending = undefined;
  if (!run && this.current?.session.matches(file,context)) {
   await this.current.session.render(file,config,false,context); return;
  }
  const layer = createDetachedEl(this.host.ownerDocument,"div");
  layer.className = "cv-editor-preview-layer is-pending"; this.host.appendChild(layer);
  const next = this.pending = {session:new PreviewSession(this.app,layer,this.basesProvider,this.leaf),layer,run};
  try {
   await next.session.render(file,config,run,context);
   if(generation !== this.generation) return;
   await this.readyImages(next.session.getFrame());
   if (generation !== this.generation) return;
   this.dispose(this.current); this.current = next; this.pending = undefined;
   layer.classList.remove("is-pending");
   // Remove only the empty-state message, never move a live iframe between parents.
   for (const child of Array.from(this.host.children)) if (child !== layer) child.remove();
  } catch(error) {
   if (generation === this.generation) { this.dispose(next);this.pending=undefined;throw error; }
  }
 }
 private async readyImages(frame?: HTMLIFrameElement) {
  const images=Array.from(frame?.contentDocument?.images ?? []).filter(img=>!img.complete);
  if (!images.length) return;
  await new Promise<void>(resolve=>{
   const cleanups:(()=>void)[]=[];let remaining=images.length,finished=false;
   const finish=()=>{if(finished)return;finished=true;for(const cleanup of cleanups)cleanup();this.cancelImageWait=undefined;resolve();};
   this.cancelImageWait=finish;
   const timer=this.host.ownerDocument.defaultView!.setTimeout(finish,1500);
   cleanups.push(()=>this.host.ownerDocument.defaultView!.clearTimeout(timer));
   for(const img of images) {
    const done=()=>{if(--remaining===0)finish();};
    img.addEventListener("load",done,{once:true});img.addEventListener("error",done,{once:true});
    cleanups.push(()=>{img.removeEventListener("load",done);img.removeEventListener("error",done);});
   }
  });
 }
 refreshTheme() { this.current?.session.refreshTheme();this.pending?.session.refreshTheme(); }
 private dispose(value?: {session:PreviewSession;layer:HTMLElement}) {value?.session.clear();value?.layer.remove();}
 clear() {this.generation++;this.cancelImageWait?.();this.dispose(this.pending);this.dispose(this.current);this.pending=undefined;this.current=undefined;this.host.replaceChildren();}
}
