import { afterEach, expect, it, vi } from "vitest";
import { Menu, Platform, type App, type MenuItem } from "obsidian";
import { panelOrderMenu, reorderHandle } from "../view-editor-layout";

afterEach(() => vi.restoreAllMocks());
it("provides native menu actions for touch, bounded by the visible panel order", () => {
 const items: { title: string; disabled: boolean; click: () => void }[] = [];
 vi.spyOn(Menu.prototype, "addItem").mockImplementation(function (callback) {
  const row = { title: "", disabled: false, click: () => {} };
  const item = {
   setTitle(value: string) { row.title = value; return item; },
   setIcon() { return item; },
   setDisabled(value: boolean) { row.disabled = value; return item; },
   onClick(callback: () => void) { row.click = callback; return item; },
  };
  callback(item as unknown as MenuItem); items.push(row); return this;
 });
 const move = vi.fn();
 expect(panelOrderMenu("css", ["css", "js"], move)).toBeInstanceOf(Menu);
 expect(items.map(item => [item.title, item.disabled])).toEqual([["Move earlier", true], ["Move later", false]]);
 items[0].click(); expect(move).not.toHaveBeenCalled();
 items[1].click(); expect(move).toHaveBeenCalledWith("css", "js");
 items.length = 0; move.mockClear();
 panelOrderMenu("js", ["js"], move);
 for (const item of items) { expect(item.disabled).toBe(true); item.click(); }
 expect(move).not.toHaveBeenCalled();
});


it("describes the available touch control rather than advertising desktop dragging", () => {
 vi.spyOn(Platform, "isMobile", "get").mockReturnValue(true);
 const heading = document.createElement("div"); heading.textContent = "HTML";
 const panel = document.createElement("div"); panel.append(heading);
 const handleDrag = vi.fn();
 reorderHandle({ dragManager: { handleDrag, handleDrop() {} } } as unknown as App, {}, heading, "html", () => [], vi.fn());
 expect(heading.getAttribute("aria-label")).toContain("reorder button");
 expect(handleDrag).not.toHaveBeenCalled();
});

it("routes panel drops over editor content through native handling, preserving ordinary text drops", () => {
 const owner = {}, move = vi.fn(), contentDrop = vi.fn();
 const panel = document.createElement("div"), heading = document.createElement("div"), content = document.createElement("div");
 panel.append(heading, content);
 const manager = {
  draggable: { type: "custom-view-code", source: owner, key: "html", title: "HTML" },
  handleDrag() {}, showOverlay: vi.fn(),
  // Native handleDrop uses bubbling and ignores events consumed by CodeMirror.
  handleDrop(el: Pick<HTMLElement, "addEventListener">, callback: (event: Event, drag: unknown, checking: boolean) => unknown) {
   for (const type of ["dragover", "dragenter", "drop"]) el.addEventListener(type, event => {
    if (!event.defaultPrevented && callback(event, this.draggable, type !== "drop")) event.preventDefault();
   });
  }
 };
 content.addEventListener("drop", event => { contentDrop(); event.preventDefault(); });
 reorderHandle({ dragManager: manager } as unknown as App, owner, heading, "css", () => [], move);
 const dispatch = (type: string) => { const event = new Event(type, { bubbles: true, cancelable: true }); content.dispatchEvent(event); return event; };
 expect(dispatch("dragover").defaultPrevented).toBe(true);
 expect(manager.showOverlay).toHaveBeenCalledOnce();
 dispatch("drop"); expect(move).toHaveBeenCalledWith("html", "css"); expect(contentDrop).not.toHaveBeenCalled();
 manager.draggable.key = "css";
 move.mockClear(); dispatch("drop"); expect(move).not.toHaveBeenCalled(); expect(contentDrop).not.toHaveBeenCalled();
 manager.draggable.type = "text";
 dispatch("drop"); expect(contentDrop).toHaveBeenCalledOnce();
});
