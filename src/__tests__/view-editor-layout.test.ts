import { describe, it, expect } from "vitest";
import { normalizeWorkbench, responsiveDock, horizontalCodePanels } from "../view-editor-workbench";
import { labelPreviewContexts, splitter } from "../view-editor-layout";
import { vi } from "vitest";

describe("editor layout restoration", () => {
 it("recovers from missing or invalid workspace state", () => {
  for (const state of [null,undefined,17,"bad",{}]) expect(normalizeWorkbench(state)).toMatchObject({dock:"right",ratio:.5,visible:["template","css","js"]});
 });
 it("preserves hidden sections and order without accepting invalid section identifiers", () => {
  expect(normalizeWorkbench({dock:"bottom",ratio:.6,order:["js","js","invalid","template"],visible:[],weights:{template:NaN,css:Infinity,js:-4}})).toMatchObject({dock:"bottom",ratio:.6,order:["js","template","css"],visible:[],weights:{template:1/3,css:.9,js:.05}});
 });
 it("bounds dock dimensions after corrupted or extreme saved sizes", () => {
  expect(normalizeWorkbench({ratio:999}).ratio).toBe(.9);
  expect(normalizeWorkbench({ratio:-1}).ratio).toBe(.1);
  expect(normalizeWorkbench({ratio:NaN}).ratio).toBe(.5);
 });
});

describe("accessible splitters", () => {
 it("resizes with the axis-appropriate keys, clamps size, and resets equally", () => {
  const host=document.createElement("div");
  host.createDiv = (options) => {const el=document.createElement("div");for(const [k,v] of Object.entries(typeof options === "object" ? options.attr ?? {} : {}))el.setAttribute(k,String(v));host.appendChild(el);return el;};
  let size=.89; const done=vi.fn();
  const handle=splitter(host,()=>"x",()=>size,value=>size=value,done,"Code width");
  handle.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight"})); expect(size).toBe(.9);
  handle.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown"})); expect(done).toHaveBeenCalledTimes(1);
  handle.dispatchEvent(new KeyboardEvent("keydown",{key:"Home"})); expect(size).toBe(.5);
  expect(handle.getAttribute("aria-valuenow")).toBe("50");
  expect(handle.getAttribute("aria-orientation")).toBe("vertical");
 });
});


describe("preview context accessibility", () => {
 it("names each group without creating an Obsidian group tooltip", () => {
  const groups = [document.createElement("div"), document.createElement("div")];
  for (const group of groups) {
   labelPreviewContexts(group);
   expect(group.getAttribute("role")).toBe("group");
   expect(group.hasAttribute("aria-label")).toBe(false);
   expect(group.hasAttribute("title")).toBe(false);
   const label = group.querySelector("span")!;
   expect(label.hidden).toBe(true);
   expect(label.textContent).toBe("Preview context");
   expect(group.getAttribute("aria-labelledby")).toBe(label.id);
  }
  expect(groups[0].getAttribute("aria-labelledby")).not.toBe(groups[1].getAttribute("aria-labelledby"));
 });
});


describe("narrow editor panes", () => {
 it("stacks side docking on phones without changing the saved preference", () => {
  const state = normalizeWorkbench({ dock: "left" });
  expect(responsiveDock(state.dock, 390)).toBe("bottom");
  expect(state.dock).toBe("left");
  expect(responsiveDock(state.dock, 900)).toBe("left");
  expect(responsiveDock("right", 320)).toBe("bottom");
 });
 it("keeps explicit vertical docking and defers adaptation while unmeasured", () => {
  expect(responsiveDock("top", 390)).toBe("top");
  expect(responsiveDock("bottom", 390)).toBe("bottom");
  expect(responsiveDock("right", 0)).toBe("right");
 });
});


it("keeps narrow code panels readable even when the keyboard reduces height", () => {
 expect(horizontalCodePanels(390, 180)).toBe(false);
 expect(horizontalCodePanels(800, 400)).toBe(true);
 expect(horizontalCodePanels(800, 900)).toBe(false);
});


it("tracks a touch pointer until cancellation and reports reset size accessibly", () => {
 const host = document.createElement("div");
 host.createDiv = options => {
  const el = document.createElement("div");
  for (const [key, value] of Object.entries(typeof options === "object" ? options.attr ?? {} : {})) el.setAttribute(key, String(value));
  host.append(el); return el;
 };
 host.getBoundingClientRect = () => new DOMRect(0, 0, 390, 600);
 let size = .5, captured: number | undefined; const done = vi.fn();
 const handle = splitter(host, () => "y", () => size, value => size = value, done, "Preview height");
 handle.setPointerCapture = id => { captured = id; };
 handle.hasPointerCapture = id => captured === id;
 handle.releasePointerCapture = () => { captured = undefined; };
 const pointer = (type: string, y: number) => {
  const event = new MouseEvent(type, { clientY: y, button: 0, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: 7 }, pointerType: { value: "touch" } });
  handle.dispatchEvent(event);
 };
 pointer("pointerdown", 300); pointer("pointermove", 360);
 expect(size).toBe(.6); expect(handle.getAttribute("aria-valuenow")).toBe("60");
 pointer("pointercancel", 360); pointer("pointermove", 500);
 expect(size).toBe(.6); expect(done).toHaveBeenCalledOnce();
 handle.dispatchEvent(new MouseEvent("dblclick"));
 expect(size).toBe(.5); expect(handle.getAttribute("aria-valuenow")).toBe("50");
});
