import { describe, expect, it } from "vitest";
import { createDetachedEl } from "../dom";

describe("Obsidian element creation", () => {
	it("creates detached elements in the requested document", () => {
		const frame = window.document.body.appendChild(window.document.createElement("iframe"));
		try {
			const target = frame.contentDocument!;
			target.defaultView!.createEl = tag => target.createElement(tag);
			const element = createDetachedEl(target, "button");
			expect(element.ownerDocument).toBe(target);
			expect(element.parentNode).toBeNull();
			expect(element.tagName).toBe("BUTTON");
			expect(Object.getPrototypeOf(element)).toBe(Object.getPrototypeOf(target.createElement("button")));
		} finally { frame.remove(); }
	});
});
