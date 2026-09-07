import { createDetachedEl } from "./dom";
import type { ViewConfig } from "./types";

/** Fit the native iframe after its asynchronous editor document is mounted. */
export function fitIframeEditor(editorEl: HTMLElement, config: ViewConfig, requestMeasure: () => void = () => {}, contentHeight: () => number = () => 1): () => void {
	const frame = editorEl.querySelector<HTMLIFrameElement>(":scope > iframe");
	if (!frame) return () => {};
	let source: HTMLElement | null = null;
	let style: HTMLStyleElement | undefined;
	let width = 0;
	const measure = () => {
		if (!source || !frame.clientWidth) { width = 0; return; }
		if (width !== frame.clientWidth) { width = frame.clientWidth; requestMeasure(); }
		const height = `${Math.ceil(Math.max(contentHeight(), source.getBoundingClientRect().height, 1))}px`;
		if (frame.style.getPropertyValue("--cv-editor-height") !== height) frame.style.setProperty("--cv-editor-height", height);
	};
	const resize = new ResizeObserver(measure);
	const mount = new MutationObserver(() => attach());
	function attach() {
		const doc = frame!.contentDocument;
		const next = doc?.querySelector<HTMLElement>(".markdown-source-view");
		if (!doc || !next) return;
		mount.disconnect();
		if (next === source) { measure(); return; }
		if (source) resize.unobserve(source);
		style?.remove();
		source = next;
		style = createDetachedEl(doc, "style");
		style.textContent = `
			body .markdown-source-view.markdown-source-view {
				height: auto; min-height: 0; max-height: none; position: relative; overflow: visible;
			}
			body .cm-editor.cm-editor, body .cm-sizer { min-height: 0; }
			${config.showProperties === false ? 'body .markdown-source-view.is-live-preview.show-properties .metadata-container:not(.mod-error), body .metadata-container { display: none; }' : ''}
			${config.showInlineTitle === false ? 'body .inline-title { display: none; }' : ''}
		`;
		doc.head.append(style);
		resize.observe(source);
		measure();
		requestMeasure();
	}
	function loaded() {
		mount.disconnect();
		if (frame!.contentDocument) mount.observe(frame!.contentDocument, { childList: true, subtree: true });
		attach();
	}
	frame.addEventListener("load", loaded);
	resize.observe(frame);
	loaded();
	return () => {
		frame.removeEventListener("load", loaded);
		mount.disconnect(); resize.disconnect(); style?.remove();
		frame.style.removeProperty("--cv-editor-height");
	};
}
