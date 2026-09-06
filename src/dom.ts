/** Create detached elements with Obsidian's helper while retaining the target window. */
export function createDetachedEl<K extends keyof HTMLElementTagNameMap>(owner: Document, tag: K): HTMLElementTagNameMap[K] {
	const targetWindow = owner.defaultView;
	const element = targetWindow?.createEl ? targetWindow.createEl(tag) : createEl(tag);
	return owner.adoptNode(element);
}
