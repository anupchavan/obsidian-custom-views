import { describe, it, expect, vi } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorWorkbench } from "../view-editor-workbench";

describe("editor synchronization",()=>{
 function workbench(context="note") {
  const view={id:"one",name:"One",rules:{operator:"and",rules:[]},template:"before",css:"",js:""};
  const w=Object.assign(Object.create(EditorWorkbench.prototype),{view,context,closed:false,applyingRemote:false,rulesSnapshot:JSON.stringify([view.rules,undefined]),plugin:{settings:{views:[view]}},requestPreview:vi.fn(),requestSave:vi.fn(),editors:new Map()});
  for(const key of ["template","css","js"]) {
   const editor={state:EditorState.create({doc:key==="template"?"before":""}),dispatch:vi.fn((transaction:TransactionSpec)=>{expect(w.applyingRemote).toBe(true);editor.state=editor.state.update(transaction).state;})};
   w.editors.set(key,{editor});
  }
  return w;
 }
 it("updates changed text only without creating save loops",()=>{
  const a=workbench(),b=workbench();b.view=a.view;b.plugin=a.plugin;
  a.view.template="before, after";
  a.syncEditors();b.syncEditors();
  for(const w of [a,b]) {
   expect(w.editors.get("template").editor.state.doc.toString()).toBe("before, after");
   expect(w.editors.get("template").editor.dispatch.mock.calls[0][0].changes).toEqual({from:6,to:6,insert:", after"});
   expect(w.editors.get("css").editor.dispatch).not.toHaveBeenCalled();
   expect(w.requestPreview).toHaveBeenCalledOnce();expect(w.requestSave).not.toHaveBeenCalled();
   w.syncEditors();expect(w.requestPreview).toHaveBeenCalledOnce();
  }
 });
 it("syncs JavaScript without executing it or rerendering the preview",()=>{
  const w=workbench();w.view.js="console.log('new')";w.syncEditors();
  expect(w.editors.get("js").editor.state.doc.toString()).toBe(w.view.js);expect(w.requestPreview).not.toHaveBeenCalled();
 });
});


it("retires an editor whose view was deleted instead of allowing orphan edits", () => {
 const host = { createDiv: vi.fn() };
 const editor = Object.assign(Object.create(EditorWorkbench.prototype), {
  closed: false, dirty: true, view: { id: "deleted" },
  plugin: { settings: { views: [] } }, host,
 });
 editor.dispose = vi.fn(() => { expect(editor.dirty).toBe(false); editor.closed = true; });
 editor.syncEditors(); editor.syncEditors();
 expect(editor.dispose).toHaveBeenCalledOnce();
 expect(host.createDiv).toHaveBeenCalledWith(expect.objectContaining({ attr: { role: "status" }, text: expect.stringContaining("deleted") }));
});
