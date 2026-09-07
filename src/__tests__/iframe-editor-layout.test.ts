import { afterEach, expect, it, vi } from "vitest";
import { fitIframeEditor } from "../iframe-editor-layout";
import type { ViewConfig } from "../types";

afterEach(() => { window.document.body.replaceChildren(); vi.unstubAllGlobals(); });
it("fits the iframe to its editor as content changes and restores its native layout", () => {
	let resize!: () => void;
	const disconnect = vi.fn();
	vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
	const holder = window.document.body.appendChild(window.document.createElement("div"));
	const frame = holder.appendChild(window.document.createElement("iframe"));
	const doc = frame.contentDocument!;
	doc.body.innerHTML = '<div class="markdown-source-view"><div class="inline-title">Title</div></div>';
	const source = doc.querySelector<HTMLElement>(".markdown-source-view")!;
	let height = 320;
	vi.spyOn(source, "getBoundingClientRect").mockImplementation(() => ({ height }) as DOMRect);
	const restore = fitIframeEditor(holder, { showProperties: false, showInlineTitle: false } as ViewConfig);
	expect(frame.style.getPropertyValue("--cv-editor-height")).toBe("320px");
	height = 560; resize();
	expect(frame.style.getPropertyValue("--cv-editor-height")).toBe("560px");
	height = 120; resize();
	expect(frame.style.getPropertyValue("--cv-editor-height")).toBe("120px");
	expect(doc.head.querySelector("style")).not.toBeNull();
	restore();
	expect(disconnect).toHaveBeenCalledOnce();
	expect(doc.head.querySelector("style")).toBeNull();
	expect(frame.style.getPropertyValue("--cv-editor-height")).toBe("");
});
