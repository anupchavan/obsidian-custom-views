import { createDetachedEl } from "./dom";
import type { ViewConfig } from "./types";

/** Let the outer template scroll an iframe editor, including its native metadata. */
export function fitIframeEditor(editorEl: HTMLElement, config: ViewConfig): () => void {
	const frame = editorEl.querySelector<HTMLIFrameElement>(":scope > iframe");
	const doc = frame?.contentDocument;
	const source = doc?.querySelector<HTMLElement>(".markdown-source-view");
	if (!frame || !doc || !source) return () => {};
	const style = createDetachedEl(doc, "style");
	style.textContent = `
		html, body { height: auto; min-height: 0; overflow: hidden; }
		body .markdown-source-view.markdown-source-view {
			height: auto; min-height: 0; max-height: none; position: relative; overflow: visible;
		}
		body .cm-editor.cm-editor, body .cm-sizer { min-height: 0; }
		${config.showProperties === false ? 'body .markdown-source-view.is-live-preview.show-properties .metadata-container:not(.mod-error), body .metadata-container { display: none; }' : ''}
		${config.showInlineTitle === false ? 'body .inline-title { display: none; }' : ''}
	`;
	doc.head.append(style);
	const measure = () => {
		const height = `${Math.ceil(source.getBoundingClientRect().height)}px`;
		if (frame.style.getPropertyValue("--cv-editor-height") !== height) frame.style.setProperty("--cv-editor-height", height);
	};
	const observer = new ResizeObserver(measure);
	observer.observe(source);
	measure();
	return () => { observer.disconnect(); style.remove(); frame.style.removeProperty("--cv-editor-height"); };
}
