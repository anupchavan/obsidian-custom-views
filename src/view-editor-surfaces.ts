import { Component, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import type { ViewContext } from "./types";

interface CanvasNode {
 child: Component;
 alwaysKeepLoaded: boolean;
 contentEl: HTMLElement;
 nodeEl: HTMLElement;
 render(): void;
 attach(): void;
}
interface NativeCanvas {
 wrapperEl: HTMLElement;
 createFileNode(options: {pos:{x:number;y:number};position:string;file:TFile;save:boolean;focus:boolean}): CanvasNode;
 load(): void;
 unload(): void;
 onResize(): void;
 selectOnly(node: CanvasNode): void;
 setViewport(x:number,y:number,zoom:number): void;
 zoomToSelection(): void;
}
interface CanvasView extends Component {
 canvas: NativeCanvas;
 containerEl: HTMLElement;
 requestSave(): void;
 saveLocalData(): void;
}

/** Real Canvas geometry, selection, handles and interaction; never loads or saves a canvas file. */
function mountCanvas(app: App, host: HTMLElement, file: TFile, leaf: WorkspaceLeaf) {
 const factory = (app as App & {viewRegistry?:{viewByType?:{canvas?:(leaf:WorkspaceLeaf)=>CanvasView}}}).viewRegistry?.viewByType?.canvas;
 if (!factory) throw new Error("Enable Canvas to preview a canvas note.");
 const view = factory(leaf);
 // ItemView construction attaches a second view container to the real leaf. Only retain its canvas.
 view.containerEl.remove();
 // This is an in-memory preview surface, with no backing canvas file.
 view.requestSave = () => {};
 view.saveLocalData = () => {};
 const canvas = view.canvas;
 const restrictions = new Component();
 let observer: ResizeObserver | undefined;
 let disposed = false;
 const dispose = () => {
  if (disposed) return;
  disposed = true;
  observer?.disconnect(); restrictions.unload(); canvas.unload(); view.unload();
  canvas.wrapperEl.remove(); view.containerEl.remove();
 };
 try {
 host.appendChild(canvas.wrapperEl);
 canvas.wrapperEl.addClass("cv-preview-canvas");
 const node = canvas.createFileNode({pos:{x:0,y:0},position:"center",file,save:false,focus:false});
 // Supply our renderer as the node's child instead of loading a second Markdown editor.
 node.child = new Component(); node.child.load(); node.alwaysKeepLoaded = true;
 node.render(); node.attach();
 restrictions.load();
 // Keep native pan/zoom/resize, but reject editing entry points on this single-note surface.
 for (const event of ["dblclick", "contextmenu", "dragover", "drop", "paste", "cut"] as const)
  restrictions.registerDomEvent(canvas.wrapperEl,event,e=>{e.preventDefault();e.stopImmediatePropagation();},{capture:true});
 restrictions.registerDomEvent(canvas.wrapperEl,"keydown",e=>{
  if (e.key === "Delete" || e.key === "Backspace" || ((e.ctrlKey || e.metaKey) && ["v","x","d","z","y"].includes(e.key.toLowerCase()))) {
   e.preventDefault(); e.stopImmediatePropagation();
  }
 },{capture:true});
 restrictions.registerDomEvent(canvas.wrapperEl,"pointerdown",e=>{
  if(e.altKey || e.metaKey || e.ctrlKey) {e.preventDefault();e.stopImmediatePropagation();}
 },{capture:true});
 canvas.load(); canvas.onResize(); canvas.setViewport(0,0,0); canvas.selectOnly(node); canvas.zoomToSelection();
 observer = new ResizeObserver(() => canvas.onResize()); observer.observe(host);
 return {container:node.contentEl,dispose};
 } catch (error) {
  dispose();
  throw error;
 }
}

export function mountPreviewSurface(app: App, host: HTMLElement, file: TFile, context: ViewContext, leaf?: WorkspaceLeaf) {
 if (context === "canvas") {
  if (!leaf) throw new Error("The editor tab is unavailable.");
  return mountCanvas(app,host,file,leaf);
 }
 if (context === "popover") {
  const stage=host.createDiv("cv-preview-popover-stage");
  // The native popover classes supply the theme's radius, shadow, border and dimensions.
  const container=stage.createDiv("popover hover-popover cv-preview-popover");
  return {container,dispose:()=>stage.remove()};
 }
 return {container:host,dispose:()=>{}};
}
