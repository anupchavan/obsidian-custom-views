import { describe, it, expect, vi } from "vitest";
import { App, Component, TFile, type WorkspaceLeaf } from "obsidian";
import { mountPreviewSurface } from "../view-editor-surfaces";

describe("native preview surfaces",()=>{
 it("uses the registered Canvas factory and native default file-node size without loading or saving a canvas file",()=>{
  const app=new App(),host=document.createElement("div"),content=document.createElement("div"),wrapper=document.createElement("div");
  wrapper.addClass=cls=>wrapper.classList.add(cls);
  const node={contentEl:content,child:undefined as Component|undefined,alwaysKeepLoaded:false,render:vi.fn(),attach:vi.fn()};
  const canvas={wrapperEl:wrapper,createFileNode:vi.fn(()=>node),load:vi.fn(),unload:vi.fn(),onResize:vi.fn(),selectOnly:vi.fn(),setViewport:vi.fn(),zoomToSelection:vi.fn()};
  const save=vi.fn(),view={canvas,containerEl:document.createElement("div"),requestSave:save,saveLocalData:save,unload:vi.fn()};
  const leafContainer=document.createElement("div");leafContainer.append(view.containerEl);
  const factory=vi.fn(()=>view);Object.assign(app,{viewRegistry:{viewByType:{canvas:factory}}});
  const disconnect=vi.fn();vi.stubGlobal("ResizeObserver",class {observe(){}disconnect=disconnect});
  const leaf={} as WorkspaceLeaf,file=new TFile();
  const surface=mountPreviewSurface(app,host,file,"canvas",leaf);
  expect(factory).toHaveBeenCalledWith(leaf);
  expect(leafContainer.childElementCount).toBe(0);expect(canvas.zoomToSelection).toHaveBeenCalledOnce();
  expect(canvas.createFileNode).toHaveBeenCalledWith({pos:{x:0,y:0},position:"center",file,save:false,focus:false});
  expect(node.child).toBeInstanceOf(Component);expect(node.alwaysKeepLoaded).toBe(true);expect(surface.container).toBe(content);
  view.requestSave();view.saveLocalData();expect(save).not.toHaveBeenCalled();
  const creation=vi.fn();wrapper.addEventListener("dblclick",creation);
  const doubleClick=new MouseEvent("dblclick",{bubbles:true,cancelable:true});wrapper.dispatchEvent(doubleClick);
  expect(doubleClick.defaultPrevented).toBe(true);expect(creation).not.toHaveBeenCalled();
  for(const type of ["drop","paste","contextmenu"]) {const event=new Event(type,{bubbles:true,cancelable:true});wrapper.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);}
  surface.dispose();surface.dispose();wrapper.dispatchEvent(new MouseEvent("dblclick"));expect(creation).toHaveBeenCalledOnce();expect(canvas.unload).toHaveBeenCalledOnce();expect(view.unload).toHaveBeenCalledOnce();expect(disconnect).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
 });
 it("keeps main-note rendering in its existing host",()=>{
  const host=document.createElement("div");expect(mountPreviewSurface(new App(),host,new TFile(),"note").container).toBe(host);
 });
});


it.each(["createFileNode", "onResize"] as const)("cleans up a failed Canvas initialization at %s", (failure) => {
 const wrapper = document.createElement("div"); wrapper.addClass = cls => wrapper.classList.add(cls);
 const node = { contentEl: document.createElement("div"), render() {}, attach() {} };
 const canvas = { wrapperEl: wrapper, createFileNode: vi.fn(() => node), load: vi.fn(), unload: vi.fn(), onResize: vi.fn() };
 canvas[failure].mockImplementation(() => { throw new Error("Initialization failed"); });
 const view = { canvas, containerEl: document.createElement("div"), unload: vi.fn() };
 const app = Object.assign(new App(), { viewRegistry: { viewByType: { canvas: () => view } } });
 const host = document.createElement("div");
 expect(() => mountPreviewSurface(app, host, new TFile(), "canvas", {} as WorkspaceLeaf)).toThrow("Initialization failed");
 expect(host.children).toHaveLength(0);
 expect(canvas.unload).toHaveBeenCalledOnce(); expect(view.unload).toHaveBeenCalledOnce();
});
