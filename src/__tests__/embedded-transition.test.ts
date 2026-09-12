import { afterEach, expect, it, vi } from "vitest";
import { holdEmbeddedView, settleEmbeddedView } from "../embedded-transition";
afterEach(() => window.document.body.replaceChildren());
it("retains the editor image and display options while the native mode changes", () => {
	const root = window.document.body.appendChild(window.document.createElement("div"));
	root.className = "obsidian-custom-view-editable cv-hide-properties";
	root.setAttribute("data-cv-id", "old-view");
	const overlay = root.appendChild(window.document.createElement("div"));
	overlay.className = "obsidian-custom-view-render";
	const frame = overlay.appendChild(window.document.createElement("iframe"));
	frame.contentDocument!.body.innerHTML = '<div class="markdown-source-view">Visible body</div>';
	const release = holdEmbeddedView(root);
	overlay.remove(); root.classList.remove("cv-hide-properties");
	root.setAttribute("data-cv-id", "new-view");
	const snapshot = root.querySelector<HTMLElement>(".cv-embedded-transition")!;
	expect(snapshot.textContent).toBe("Visible body");
	expect(snapshot.classList.contains("cv-hide-properties")).toBe(true);
	expect(snapshot.getAttribute("data-cv-id")).toBe("old-view");
	expect(snapshot.querySelector("iframe")).toBeNull();
	release();
	expect(root.children.length).toBe(0);
	expect(root.classList.contains("cv-embedded-switching")).toBe(false);
});

it("finishes even when a hidden window never delivers an animation frame", async () => {
	vi.useFakeTimers();
	const root = document.body.appendChild(document.createElement("div"));
	const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
	const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
	let finished = false;
	const pending = settleEmbeddedView(root, () => true).then(() => { finished = true; });
	try {
		await vi.advanceTimersByTimeAsync(3100);
		expect(finished).toBe(true);
		await pending;
		expect(cancel).toHaveBeenCalledWith(42);
	} finally { raf.mockRestore(); cancel.mockRestore(); vi.useRealTimers(); }
});
