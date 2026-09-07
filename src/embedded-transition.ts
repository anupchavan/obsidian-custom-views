import { createDetachedEl } from "./dom";

/** Keep the last custom frame painted while Obsidian changes editor modes. */
export function holdEmbeddedView(root: HTMLElement): () => void {
	const overlay = root.querySelector<HTMLElement>(":scope > .obsidian-custom-view-render");
	if (!overlay) return () => {};
	const holder = createDetachedEl(root.ownerDocument, "div");
	holder.className = "cv-embedded-transition";
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
