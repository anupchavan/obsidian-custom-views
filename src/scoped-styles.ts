/**
 * Wrap all unscoped <style> elements inside a container with a CSS nesting
 * selector that restricts rules to a specific data-cv-id scope.
 */
const scopedStyleContents = new WeakMap<HTMLStyleElement, string>();

export function scopeStyleElements(container: HTMLElement, scopeId: string) {
	const styles = container.querySelectorAll("style");
	for (const style of Array.from(styles)) {
		const raw = style.textContent;
		if (raw && raw !== scopedStyleContents.get(style)) {
			const scoped = `[data-cv-id="${scopeId}"] {\n${raw}\n}`;
			scopedStyleContents.set(style, scoped);
			style.textContent = scoped;
			style.setAttribute("data-cv-scoped", "true");
		}
	}
}

/** Carry trusted scoping metadata along with a stylesheet patched from a staged render. */
export function transferStyleScope(source: Node, target: Node): void {
 if (source.nodeName !== "STYLE" || target.nodeName !== "STYLE") return;
 const scoped = scopedStyleContents.get(source as HTMLStyleElement);
 if (scoped !== undefined && scoped === target.textContent)
  scopedStyleContents.set(target as HTMLStyleElement, scoped);
}
