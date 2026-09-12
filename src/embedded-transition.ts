import { createDetachedEl } from "./dom";

/** Rendering the shell finishes before the embedded iframe's layout does. */
export async function settleEmbeddedView(root: HTMLElement, current: () => boolean): Promise<void> {
	const win = root.ownerDocument.defaultView;
	if (!win) return;
	let previous = "";
	let stable = 0;
	// Bound the hold for a broken/hidden editor; never leave an inert snapshot stuck.
	for (let attempt = 0; attempt < 30 && current() && root.isConnected; attempt++) {
		await new Promise<void>(resolve => {
			const frame = win.requestAnimationFrame(() => { win.clearTimeout(timer); resolve(); });
			// Hidden windows may suspend animation frames indefinitely.
			const timer = win.setTimeout(() => { win.cancelAnimationFrame(frame); resolve(); }, 100);
		});
		if (!current()) return;
		const overlay = root.querySelector<HTMLElement>(":scope > .obsidian-custom-view-render:not(.obsidian-custom-view-pending)");
		if (!overlay) { stable = 0; continue; }
		const frame = overlay.querySelector<HTMLIFrameElement>("[data-cv-editable-placeholder] > .markdown-embed-content > iframe");
		const content = frame?.contentDocument?.querySelector<HTMLElement>(".cm-content");
		if (frame && (!content || !frame.style.getPropertyValue("--cv-editor-height"))) { stable = 0; continue; }
		const signature = JSON.stringify([overlay.clientWidth, overlay.scrollHeight,
			frame?.clientHeight, content?.getBoundingClientRect().height]);
		stable = signature === previous ? stable + 1 : 0;
		previous = signature;
		if (stable >= 2) return;
	}
}

/** Keep the last custom frame painted while Obsidian changes editor modes. */
export function holdEmbeddedView(root: HTMLElement): () => void {
	const overlay = root.querySelector<HTMLElement>(":scope > .obsidian-custom-view-render");
	if (!overlay) return () => {};
	const holder = createDetachedEl(root.ownerDocument, "div");
	holder.className = "cv-embedded-transition";
	// Resetting the live view removes/replaces its scope. The retained frame
	// must keep the old scope or its cloned stylesheet stops matching mid-switch.
	const scopeId = root.getAttribute("data-cv-id");
	if (scopeId) holder.setAttribute("data-cv-id", scopeId);
	for (const cls of ["obsidian-custom-view-editable", "cv-hide-properties", "cv-hide-inline-title", "cv-context-popover", "cv-context-canvas", "cv-context-embed"]) {
		if (root.classList.contains(cls)) holder.classList.add(cls);
	}
	holder.inert = true;
	holder.setAttribute("aria-hidden", "true");
	const copy = overlay.cloneNode(true) as HTMLElement;
	// An iframe clone has a new, empty document. Copy its painted editor instead.
	const originals = overlay.querySelectorAll("iframe");
	copy.querySelectorAll("iframe").forEach((frame, index) => {
		const source = originals[index]?.contentDocument?.querySelector(".markdown-source-view");
		if (source) frame.replaceWith(source.cloneNode(true));
	});
	copy.querySelectorAll("script").forEach(script => script.remove());
	holder.append(copy);
	root.style.setProperty("--cv-transition-height", `${overlay.clientHeight}px`);
	root.classList.add("cv-embedded-switching");
	root.append(holder);
	copy.scrollTop = overlay.scrollTop;
	return () => {
		holder.remove();
		root.classList.remove("cv-embedded-switching");
		root.style.removeProperty("--cv-transition-height");
	};
}
