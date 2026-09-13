import { Menu, Platform, type App } from "obsidian";
let contextGroupId = 0;

/** Obsidian treats aria-label as a tooltip; label the group by reference instead. */
export function labelPreviewContexts(group: HTMLElement): void {
 const label = group.createSpan({ text: "Preview context" });
 label.id = `cv-preview-context-${++contextGroupId}`;
 label.hidden = true;
 group.setAttribute("role", "group");
 group.setAttribute("aria-labelledby", label.id);
}

/** Small, event-driven splitters. No timers, polling, or workspace-tree mutations. */
export function splitter(host: HTMLElement, axis: () => "x" | "y", get: () => number, set: (value: number) => void, done: () => void, label: string): HTMLElement {
	const el = host.createDiv({ cls: "cv-editor-splitter", attr: { role: "separator", tabindex: "0", "aria-label": label } });
	el.setAttribute("aria-orientation", axis() === "x" ? "vertical" : "horizontal");
	el.setAttribute("aria-valuemin", "10"); el.setAttribute("aria-valuemax", "90");
	el.setAttribute("aria-valuenow", String(Math.round(get() * 100)));
	let start = 0, initial = 0, extent = 0;
	el.addEventListener("pointerdown", event => {
		if (event.button !== 0) return;
		event.preventDefault();
		const rect = host.getBoundingClientRect();
		start = axis() === "x" ? event.clientX : event.clientY;
		extent = axis() === "x" ? rect.width : rect.height;
		initial = get();
		el.setPointerCapture(event.pointerId);
	});
	el.addEventListener("pointermove", event => {
		if (!el.hasPointerCapture(event.pointerId) || !extent) return;
		const point = axis() === "x" ? event.clientX : event.clientY;
		set(Math.max(0.1, Math.min(0.9, initial + (point - start) / extent)));
		el.setAttribute("aria-valuenow", String(Math.round(get() * 100)));
	});
	const finish = (event: PointerEvent) => { if (el.hasPointerCapture(event.pointerId)) { el.releasePointerCapture(event.pointerId); done(); } };
	el.addEventListener("pointerup", finish);
	el.addEventListener("pointercancel", finish);
	el.addEventListener("keydown", event => {
		const negative = axis() === "x" ? "ArrowLeft" : "ArrowUp";
		const positive = axis() === "x" ? "ArrowRight" : "ArrowDown";
		if (event.key !== negative && event.key !== positive && event.key !== "Home") return;
		event.preventDefault();
		set(event.key === "Home" ? 0.5 : Math.max(0.1, Math.min(0.9, get() + (event.key === negative ? -0.02 : 0.02))));
		el.setAttribute("aria-valuenow", String(Math.round(get() * 100)));
		done();
	});
	el.addEventListener("dblclick", () => { set(0.5); el.setAttribute("aria-valuenow", "50"); done(); });
	return el;
}

interface PanelDrag { type: string; source: object; key: string; title: string; icon: string }
interface NativeDragManager {
	draggable?: PanelDrag;
	onDragEnd(): void;
	handleDrag(el: HTMLElement, factory: (event: DragEvent) => PanelDrag | null): void;
	handleDrop(el: Pick<HTMLElement, "addEventListener">, callback: (event: DragEvent, drag: PanelDrag | null, checking: boolean) => boolean | {action: string; dropEffect: string}): void;
	showOverlay(doc: Document, rect: {x:number;y:number;width:number;height:number}): void;
	updateSource(elements: HTMLElement[], cls: string): void;
}
export function reorderHandle<T extends string>(app: App, owner: object, heading: HTMLElement, key: T, panels: () => { key: T; element: HTMLElement }[], move: (from: T, to: T) => void) {
	const manager = (app as App & {dragManager?: NativeDragManager}).dragManager;
	heading.setAttribute("tabindex", "0");
	heading.setAttribute("aria-label", `${heading.textContent}. ${Platform.isMobile ? "Use the reorder button, or Alt and arrow keys." : "Drag to reorder, or use Alt and arrow keys."}`);
	if (!Platform.isMobile) manager?.handleDrag(heading, event => {
		if ((event.target as HTMLElement).closest("button,input,.clickable-icon")) return null;
		manager.updateSource([heading],"is-being-dragged");
		return {type:"custom-view-code",source:owner,key,title:heading.textContent ?? key,icon:"code-xml"};
	});
	// Register native drop handling in capture phase so embedded editors cannot
	// consume a panel drag as text. External text/file drags retain editor behavior.
	const dropTarget: Pick<HTMLElement, "addEventListener"> = {
		addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
			heading.parentElement!.addEventListener(type, event => {
				const drag = manager?.draggable;
				if (drag?.type !== "custom-view-code" || drag.source !== owner) return;
				if (typeof listener === "function") listener(event); else listener.handleEvent(event);
				if (event.defaultPrevented) event.stopPropagation();
			}, true);
		}
	};
	manager?.handleDrop(dropTarget, (event,drag,checking) => {
		if (!drag || drag.type !== "custom-view-code" || drag.source !== owner) return false;
		if (checking) {
			const rect = heading.parentElement!.getBoundingClientRect();
			manager.showOverlay(heading.ownerDocument,rect);
			return {action:`Move ${drag.title} here`,dropEffect:"move"};
		}
		if (drag.key !== key) move(drag.key as T,key); return true;
	});
	heading.addEventListener("keydown", event => {
		if (!event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
		event.preventDefault();
		const all = panels(), index = all.findIndex(panel => panel.key === key);
		const target = all[index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1)];
		if (target) move(key, target.key);
	});
}

export function cancelPanelDrag(app: App, owner: object) {
 const manager = (app as App & {dragManager?: NativeDragManager}).dragManager;
 if (manager?.draggable?.source === owner) manager.onDragEnd();
}


/** Touch alternative to native desktop dragging and Alt-arrow reordering. */
export function panelOrderMenu<T extends string>(key: T, keys: T[], move: (from: T, to: T) => void): Menu {
 const menu = new Menu();
 const index = keys.indexOf(key);
 for (const [offset, title, icon] of [[-1, "Move earlier", "arrow-up"], [1, "Move later", "arrow-down"]] as const) {
  const target = index >= 0 ? keys[index + offset] : undefined;
  menu.addItem(item => item.setTitle(title).setIcon(icon).setDisabled(target === undefined).onClick(() => {
   if (target !== undefined) move(key, target);
  }));
 }
 return menu;
}
