import type { App, Component } from "obsidian";

// Obsidian's embedded-editor window relay also forwards these events. Keep this
// at the iframe boundary: individual menus must retain their native behavior.
const EVENTS = ["fullscreenchange", "click", "contextmenu", "auxclick", "keydown", "keyup", "mousedown", "mouseup", "mousemove", "copy", "paste", "cut", "drag", "dragstart", "dragover", "dragend", "dragenter", "dragleave", "drop"];

export function registerPreviewWindow(frame: HTMLIFrameElement, lifetime: Component, app?: App): void {
 const child = frame.contentWindow;
 const parent = frame.ownerDocument.defaultView;
 if (!child || !parent) return;
 // Same realm initialization used by Obsidian's native embedded editor, so
 // event targets support its cross-window DOM helpers (targetNode/instanceOf).
 const enhance = (parent as Window & { globalEnhance?: () => void }).globalEnhance;
 if (app) Object.assign(child, { app });
 if (enhance) (child as Window & { eval(code: string): unknown }).eval(`(${enhance.toString()})()`);
 const relay = (original: Event) => {
  if ((original as Event & { isRelayed?: boolean }).isRelayed) return;
  const Constructor = original.constructor as new (type: string, init: Event) => Event;
  const event = new Constructor(original.type, original);
  Object.assign(event, { isRelayed: true, isSynthetic: (original as Event & { isSynthetic?: boolean }).isSynthetic });
  for (const method of ["preventDefault", "stopPropagation", "stopImmediatePropagation"] as const) {
   const invoke = event[method].bind(event);
   event[method] = () => { invoke(); original[method](); };
  }
  Object.defineProperties(event, {
   target: { get: () => original.target },
   currentTarget: { get: () => original.currentTarget },
  });
  parent.dispatchEvent(event);
 };
 const listen = (type: string, callback: EventListener) => {
  child.addEventListener(type, callback, true);
  lifetime.register(() => child.removeEventListener(type, callback, true));
 };
 for (const type of EVENTS) listen(type, relay);
 listen("focus", event => {
  relay(event);
  frame.dispatchEvent(new parent.FocusEvent("focusin", { bubbles: true }));
 });
 listen("blur", relay);
}
