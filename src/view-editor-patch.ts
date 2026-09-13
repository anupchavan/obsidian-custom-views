import { transferStyleScope } from "./scoped-styles";
/** Track authored nodes separately from changes made by the preview's scripts. */
export interface PreviewTree { node: Node; children: PreviewTree[]; live: Node }
export function capturePreview(node: Node): PreviewTree {
	return { node: node.cloneNode(false), live: node, children: Array.from(node.childNodes, capturePreview) };
}
function compatible(a: Node, b: Node) {
	return a.nodeType === b.nodeType && a.nodeName === b.nodeName &&
		(a.nodeType !== 1 || (a as Element).id === (b as Element).id);
}
/** Only authored differences are applied; unchanged images, runtime styles and listeners survive. */
export function patchPreview(old: PreviewTree, next: Node): PreviewTree {
	const live = old.live;
	if (next.nodeType === 1) {
		const before = old.node as Element, after = next as Element, target = live as Element;
		for (const name of new Set([...before.getAttributeNames(), ...after.getAttributeNames()])) {
			if (before.getAttribute(name) === after.getAttribute(name)) continue;
			if (name === "style") {
				const a = (before as HTMLElement).style, b = (after as HTMLElement).style, c = (target as HTMLElement).style;
				for (const prop of new Set([...Array.from(a), ...Array.from(b)])) {
					if (a.getPropertyValue(prop) !== b.getPropertyValue(prop) || a.getPropertyPriority(prop) !== b.getPropertyPriority(prop))
						if (b.getPropertyValue(prop)) c.setProperty(prop,b.getPropertyValue(prop),b.getPropertyPriority(prop)); else c.removeProperty(prop);
				}
			} else if (name === "class") {
				for (const cls of Array.from(before.classList)) if (!after.classList.contains(cls)) target.classList.remove(cls);
				for (const cls of Array.from(after.classList)) if (!before.classList.contains(cls)) target.classList.add(cls);
			} else if (after.hasAttribute(name)) target.setAttribute(name,after.getAttribute(name)!);
			else target.removeAttribute(name);
		}
	} else if (old.node.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue;
	const available = [...old.children];
	const authored = new Set(old.children.map(child => child.live));
	const children: PreviewTree[] = [];
	let previous: Node | undefined;
	for (const node of Array.from(next.childNodes)) {
		const index = available.findIndex(child => compatible(child.node,node));
		const match = index < 0 ? undefined : available.splice(index,1)[0];
		const child = match ? patchPreview(match,node) : capturePreview(node);
		if (!match || child.live.parentNode === live) {
			let anchor = previous ? previous.nextSibling : live.firstChild;
			// Skip script-created siblings: moving an unchanged subtree can reload its embedded frames.
			while (anchor && anchor !== child.live && !authored.has(anchor)) anchor = anchor.nextSibling;
			if (child.live !== anchor) live.insertBefore(child.live,anchor);
			previous = child.live;
		}
		children.push(child);
	}
	for (const child of available) if (child.live.parentNode === live) live.removeChild(child.live);
	transferStyleScope(next, live);
	return { node: next.cloneNode(false), live, children };
}
