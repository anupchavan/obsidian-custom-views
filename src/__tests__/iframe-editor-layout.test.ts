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
	let width = 0;
	Object.defineProperty(frame, "clientWidth", { get: () => width });
	const doc = frame.contentDocument!;
	doc.body.innerHTML = '<div class="markdown-source-view"><div class="inline-title">Title</div></div>';
	const source = doc.querySelector<HTMLElement>(".markdown-source-view")!;
	let height = 320;
	vi.spyOn(source, "getBoundingClientRect").mockImplementation(() => ({ height }) as DOMRect);
	const requestMeasure = vi.fn();
	const restore = fitIframeEditor(holder, { showProperties: false, showInlineTitle: false } as ViewConfig, requestMeasure);
	expect(frame.style.getPropertyValue("--cv-editor-height")).toBe("");
	width = 400; resize();
	expect(requestMeasure).toHaveBeenCalledTimes(2);
	expect(frame.style.getPropertyValue("--cv-editor-height")).toBe("320px");
	width = 0; height = 0; resize();
	expect(frame.style.getPropertyValue("--cv-editor-height")).toBe("320px");
	width = 400; height = 560; resize();
	expect(frame.style.getPropertyValue("--cv-editor-height")).toBe("560px");
	expect(requestMeasure).toHaveBeenCalledTimes(3);
	height = 120; resize();
	expect(frame.style.getPropertyValue("--cv-editor-height")).toBe("120px");
	expect(doc.head.querySelector("style")).not.toBeNull();
	restore();
	expect(disconnect).toHaveBeenCalledOnce();
	expect(doc.head.querySelector("style")).toBeNull();
	expect(frame.style.getPropertyValue("--cv-editor-height")).toBe("");
});

 it("waits for an editor mounted after the iframe document is created", async () => {
	vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
	const holder = window.document.body.appendChild(window.document.createElement("div"));
	const frame = holder.appendChild(window.document.createElement("iframe"));
	Object.defineProperty(frame, "clientWidth", { value: 400 });
	const restore = fitIframeEditor(holder, {} as ViewConfig, () => {}, () => 240);
	try {
		expect(frame.style.getPropertyValue("--cv-editor-height")).toBe("");
		frame.contentDocument!.body.innerHTML = '<div class="markdown-source-view"></div>';
		await vi.waitFor(() => expect(frame.style.getPropertyValue("--cv-editor-height")).toBe("240px"));
		expect(frame.contentDocument!.head.querySelector("style")).not.toBeNull();
	} finally { restore(); }
});
