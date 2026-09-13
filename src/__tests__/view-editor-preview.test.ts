import { describe, it, expect, vi } from "vitest";
import { App, TFile } from "obsidian";
import type { ViewConfig } from "../types";
vi.mock("../renderer",()=>({renderTemplate:vi.fn(async (...args:unknown[])=>{
 const node=args[3] as HTMLElement;
 node.innerHTML=args[1] as string;
 (args[12] as (()=>void)|undefined)?.();
 if(args[8]) node.firstElementChild?.setAttribute("data-ready","yes");
})}));
import { EditorPreview } from "../view-editor-preview";
import { renderTemplate } from "../renderer";
function makeHost() {
 const host=document.createElement("div");document.body.append(host);
 host.empty=()=>{host.replaceChildren();};
 host.createEl=((tag:string,options:{cls:string;attr:Record<string,string>})=>{
  const el=document.createElement(tag);el.className=options.cls;
  for(const [key,value] of Object.entries(options.attr))el.setAttribute(key,value);
  host.append(el);return el;
 }) as typeof host.createEl;
 return host;
}
describe("editor preview lifecycle",()=>{
 it("retains its frame and scroll through edits, restarts on run, and clears on close",async()=>{
  const host=makeHost();
  const preview=new EditorPreview(new App(),host);
  const file=Object.assign(new TFile(),{path:"note.md",basename:"note"});
  const config={template:'<article data-ready="no"><p>Before</p></article>'} as ViewConfig;
  await preview.render(file,config,true);
  const frame=host.querySelector("iframe")!,content=frame.contentDocument!.querySelector(".obsidian-custom-view-render")!;
  content.scrollTop=600;
  await preview.render(file,{...config,template:config.template.replace("Before","After")},false);
  expect(host.querySelector("iframe")).toBe(frame);expect(content.scrollTop).toBe(600);
  expect(content.firstElementChild?.getAttribute("data-ready")).toBe("yes");expect(content.textContent).toBe("After");
  await preview.render(file,config,true);expect(host.querySelector("iframe")).not.toBe(frame);
  preview.clear();expect(host.childNodes.length).toBe(0);host.remove();
 });
 it("does not commit stale async edits",async()=>{
  const host=makeHost();const preview=new EditorPreview(new App(),host);
  const file=Object.assign(new TFile(),{path:"note.md",basename:"note"});const config={template:"<p>Initial</p>"} as ViewConfig;
  await preview.render(file,config,false);
  let finish!:()=>void;
  vi.mocked(renderTemplate).mockImplementationOnce(async(...args)=>{args[3].textContent="Stale";await new Promise<void>(resolve=>{finish=resolve;});});
  const pending=preview.render(file,{...config,template:"Stale"},false);
  await preview.render(file,{...config,template:"<p>Newest</p>"},false);finish();await pending;
  expect(host.querySelector("iframe")!.contentDocument!.body.textContent).toBe("Newest");
  preview.clear();host.remove();
 });
 it("keeps the old note visible until a replacement is ready and discards superseded switches",async()=>{
  const host=makeHost(),preview=new EditorPreview(new App(),host);
  const file=Object.assign(new TFile(),{path:"first.md",basename:"first"});const config={template:"<p>First</p>"} as ViewConfig;
  await preview.render(file,config,false);const first=preview.frame;
  let finish!:()=>void;
  vi.mocked(renderTemplate).mockImplementationOnce(async(...args)=>{args[3].textContent="Second";await new Promise<void>(resolve=>finish=resolve);});
  const pending=preview.render(Object.assign(new TFile(),{path:"second.md"}),config,false);
  expect(preview.frame).toBe(first);expect(first?.isConnected).toBe(true);expect(host.querySelectorAll(".is-pending")).toHaveLength(1);
  await preview.render(Object.assign(new TFile(),{path:"third.md"}),{...config,template:"<p>Third</p>"},false);
  finish();await pending;
  expect(preview.frame?.contentDocument?.body.textContent).toBe("Third");expect(first?.isConnected).toBe(false);
  expect(host.querySelectorAll("iframe")).toHaveLength(1);preview.clear();host.remove();
 });

});
