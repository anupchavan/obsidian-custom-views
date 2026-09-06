import { afterEach, describe, expect, it, vi } from "vitest";
import { RetainedNoteHold } from "../retained-note-hold";

const holds: RetainedNoteHold[] = [];
afterEach(() => { holds.splice(0).forEach(hold => hold.dispose()); window.document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
	const host = window.document.body.appendChild(window.document.createElement("div"));
	host.setAttribute("data-cv-id", "cv-0");
	const overlay = host.appendChild(window.document.createElement("div"));
	overlay.className = "obsidian-custom-view-render";
	const style = overlay.appendChild(window.document.createElement("style"));
	style.textContent = '[data-cv-id="cv-0"] .card {color:red}';
	const card = overlay.appendChild(window.document.createElement("div"));
	card.className = "card"; card.textContent = "Old title";
	const editor = overlay.appendChild(window.document.createElement("div"));
	editor.className = "markdown-source-view"; editor.textContent = "Old body";
	const hold = new RetainedNoteHold(); holds.push(hold);
	return { host, overlay, editor, hold };
}
describe("retained custom shell", () => {
	it("retains the actual shell while native code mutates the original editor", () => {
		const s = setup(); const release = s.hold.begin(s.host);
		const snapshot = window.document.querySelector(".cv-navigation-snapshot")!;
		expect(snapshot.firstElementChild).toBe(s.overlay);
		expect(s.editor.parentElement).toBe(s.host);
		s.editor.textContent = "New body";
		expect(snapshot.querySelector(".markdown-source-view")?.textContent).toBe("Old body");
		expect(s.host.classList.contains("cv-navigation-preparing")).toBe(true);
		release();
		expect(s.host.classList.contains("cv-navigation-preparing")).toBe(false);
		expect(window.document.querySelector(".cv-navigation-snapshot")).toBeNull();
		expect(s.editor.isConnected).toBe(true);
	});
	it("isolates old styles so the new palette cannot recolor the held shell", () => {
		const s = setup(); s.hold.begin(s.host);
		const snapshot = window.document.querySelector(".cv-navigation-snapshot")!;
		expect(snapshot.getAttribute("data-cv-id")).not.toBe(s.host.getAttribute("data-cv-id"));
		expect(snapshot.querySelector("style")?.textContent).not.toContain('[data-cv-id="cv-0"]');
		expect(snapshot.querySelector("style")?.textContent).toContain(`[data-cv-id="${snapshot.getAttribute("data-cv-id")}"]`);
	});
	it("keeps one held shell until the newest navigation completes", () => {
		const s = setup(); const first = s.hold.begin(s.host); const last = s.hold.begin(s.host);
		first(); expect(s.host.classList.contains("cv-navigation-preparing")).toBe(true);
		expect(window.document.querySelectorAll(".cv-navigation-snapshot")).toHaveLength(1);
		last(); expect(s.host.classList.contains("cv-navigation-preparing")).toBe(false);
	});
	it("uses the painted overlay bounds when it covers the leaf header", () => {
		const s = setup();
		vi.spyOn(s.host, "getBoundingClientRect").mockReturnValue({ left: 284, top: 79, width: 1400, height: 974 } as DOMRect);
		vi.spyOn(s.overlay, "getBoundingClientRect").mockReturnValue({ left: 284, top: 40, width: 1400, height: 1013 } as DOMRect);
		vi.spyOn(s.host.parentElement!, "getBoundingClientRect").mockReturnValue({ left: 284, top: 40 } as DOMRect);
		s.hold.begin(s.host);
		const snapshot = window.document.querySelector<HTMLElement>(".cv-navigation-snapshot")!;
		expect(snapshot.style.top).toBe("0px");
		expect(snapshot.style.left).toBe("0px");
		expect(snapshot.style.height).toBe("1013px");
	});
	it("retargets a late palette update to the held shell only", async () => {
		const s = setup(); const release = s.hold.begin(s.host);
		const snapshot = window.document.querySelector(".cv-navigation-snapshot")!;
		const style = snapshot.querySelector("style")!;
		style.textContent = '[data-cv-id="cv-0"] .card {color:blue}';
		await Promise.resolve();
		expect(style.textContent).toContain(`[data-cv-id="${snapshot.getAttribute("data-cv-id")}"]`);
		expect(style.textContent).not.toContain('[data-cv-id="cv-0"]');
		release();
	});
	it("uses geometry measured after layout without forcing another layout at click time", () => {
		let notify!: ResizeObserverCallback;
		vi.stubGlobal("ResizeObserver", class {
			constructor(callback: ResizeObserverCallback) { notify = callback; }
			observe() {} unobserve() {} disconnect() {}
		});
		const s = setup(); s.hold.observe(s.host);
		notify([{ target: s.host } as unknown as ResizeObserverEntry], {} as ResizeObserver);
		const measure = vi.spyOn(s.overlay, "getBoundingClientRect").mockImplementation(() => { throw new Error("Synchronous layout"); });
		s.hold.begin(s.host);
		expect(measure).not.toHaveBeenCalled();
	});
});
