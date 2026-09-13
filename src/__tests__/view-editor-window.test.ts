import { expect, it, vi } from "vitest";
import { Component } from "obsidian";
import { registerPreviewWindow } from "../view-editor-window";

it("relays outside interactions and shortcuts once, preserving targets and cancellation", () => {
 const frame = document.body.appendChild(document.createElement("iframe"));
 const child = frame.contentWindow as Window & typeof window;
 const lifetime = new Component(); lifetime.load(); registerPreviewWindow(frame, lifetime);
 const received = vi.fn((event: Event) => { expect(event.target).toBe(child.document.body); event.preventDefault(); });
 window.addEventListener("mousedown", received); window.addEventListener("keydown", received);
 try {
  const mouse = new child.MouseEvent("mousedown", { bubbles: true, cancelable: true });
  child.document.body.dispatchEvent(mouse);
  expect(received).toHaveBeenCalledOnce(); expect(mouse.defaultPrevented).toBe(true);
  const key = new child.KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true });
  child.document.body.dispatchEvent(key);
  expect(received).toHaveBeenCalledTimes(2); expect(key.defaultPrevented).toBe(true);
  lifetime.unload();
  child.document.body.dispatchEvent(new child.MouseEvent("mousedown", { bubbles: true }));
  expect(received).toHaveBeenCalledTimes(2);
 } finally { lifetime.unload(); window.removeEventListener("mousedown", received); window.removeEventListener("keydown", received); frame.remove(); }
});

it("leaves unhandled preview clicks intact and exposes focus to the containing workspace", () => {
 const frame = document.body.appendChild(document.createElement("iframe"));
 const child = frame.contentWindow as Window & typeof window, lifetime = new Component(); lifetime.load();
 registerPreviewWindow(frame, lifetime);
 const click = vi.fn(), focus = vi.fn();
 child.document.body.addEventListener("click", click); frame.addEventListener("focusin", focus);
 const event = new child.MouseEvent("click", { bubbles: true, cancelable: true });
 child.document.body.dispatchEvent(event);
 expect(click).toHaveBeenCalledOnce(); expect(event.defaultPrevented).toBe(false);
 child.dispatchEvent(new child.FocusEvent("focus")); expect(focus).toHaveBeenCalledOnce();
 lifetime.unload(); frame.remove();
});
