import { afterEach, describe, expect, it, vi } from "vitest";
import { Component, Events } from "obsidian";
import { EditorWorkbench } from "../view-editor-workbench";

function workbench() {
 return Object.assign(Object.create(EditorWorkbench.prototype), {
  host: { win: window }, closed: false, runRequested: false,
  note: { path: "note.md" }, context: "note", view: { template: "", css: "", js: "" },
  plugin: { settings: { allowJavaScript: true } }, preview: { render: vi.fn().mockResolvedValue(undefined) },
 });
}
afterEach(() => vi.useRealTimers());
describe("preview scheduling", () => {
 it("preserves an explicit run across same-turn metadata or live-edit requests", async () => {
  vi.useFakeTimers(); const editor = workbench();
  editor.requestPreview(true); editor.requestPreview();
  await vi.runAllTimersAsync();
  expect(editor.preview.render).toHaveBeenCalledOnce();
  expect(editor.preview.render.mock.calls[0][2]).toBe(true);
  editor.requestPreview(); await vi.runAllTimersAsync();
  expect(editor.preview.render.mock.calls[1][2]).toBe(false);
 });
 it("does not execute scripts when disabled, closed, or without a note", async () => {
  vi.useFakeTimers(); const editor = workbench();
  editor.plugin.settings.allowJavaScript = false;
  editor.requestPreview(true); await vi.runAllTimersAsync();
  expect(editor.preview.render.mock.calls[0][2]).toBe(false);
  editor.closed = true; editor.requestPreview(true); await vi.runAllTimersAsync();
  editor.closed = false; editor.note = undefined; editor.requestPreview(true); await vi.runAllTimersAsync();
  expect(editor.preview.render).toHaveBeenCalledOnce();
  expect(editor.runRequested).toBe(false);
 });
});


it("disposes resources and flushes edits only once even if closure is repeated", () => {
 const cleanup = vi.fn(), destroy = vi.fn(), save = vi.fn();
 const editor = Object.assign(Object.create(EditorWorkbench.prototype), {
  closed: false, plugin: { app: {} }, lifecycle: { unload: vi.fn() },
  observer: { disconnect: vi.fn() }, host: { win: window, empty: vi.fn() },
  save, preview: { clear: vi.fn() }, disposeControls: [cleanup],
  editors: new Map([["template", { editor: { destroy } }]]), touched: false,
 });
 editor.dispose(); editor.dispose();
 for (const action of [save, cleanup, destroy, editor.lifecycle.unload, editor.observer.disconnect, editor.preview.clear]) expect(action).toHaveBeenCalledOnce();
});


it("releases subscribed events when an editor closes", () => {
 const lifecycle = new Component(), events = new Events(), listener = vi.fn();
 lifecycle.load(); lifecycle.registerEvent(events.on("changed", listener));
 const editor = Object.assign(Object.create(EditorWorkbench.prototype), {
  closed: false, plugin: { app: {} }, lifecycle,
  observer: { disconnect() {} }, host: { win: window, empty() {} },
  save() {}, preview: { clear() {} }, disposeControls: [], editors: new Map(), touched: false,
 });
 events.trigger("changed"); expect(listener).toHaveBeenCalledOnce();
 editor.dispose(); events.trigger("changed"); expect(listener).toHaveBeenCalledOnce();
});
