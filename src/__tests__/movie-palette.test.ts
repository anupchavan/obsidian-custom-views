import { describe, expect, it, vi } from "vitest";
// Test the exact user-template snippet that the migration installs.
import { readFileSync } from "node:fs";

const loader = readFileSync("templates/movie-palette-loader.js.txt", "utf8");
function setup(saved = "[]") {
	const container = window.document.createElement("div");
	const img = window.document.createElement("img");
	img.id = "bgImg";
	img.src = "https://example.com/poster.jpg";
	container.append(img);
	const extract = vi.fn(() => "#abcdef");
	const apply = vi.fn();
	const storage = { getItem: vi.fn(() => saved), setItem: vi.fn() };
	const win = { localStorage: storage };
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	const run = () => new Function("container", "win", "extractDominantColor", "applyPalette", loader + "\nloadPaletteFromImage();")(container, win, extract, apply);
	return { container, img, extract, apply, storage, run };
}

describe("movie palette first paint", () => {
	it("applies a persisted color before an unloaded image emits load", () => {
		const s = setup(JSON.stringify([["https://example.com/poster.jpg", "#123456"]]));
		s.run();
		expect(s.apply).toHaveBeenCalledWith("#123456");
		expect(s.extract).not.toHaveBeenCalled();
	});
	it("extracts once and reuses the color without another image-load event", () => {
		const s = setup(); s.run();
		expect(s.apply).not.toHaveBeenCalled();
		s.img.dispatchEvent(new Event("load"));
		s.run();
		expect(s.extract).toHaveBeenCalledTimes(1);
		expect(s.apply).toHaveBeenCalledTimes(2);
		expect(s.storage.setItem).toHaveBeenCalled();
	});
	it("ignores a late image callback after the note has been replaced", () => {
		const s = setup(); s.run(); s.img.remove();
		s.img.dispatchEvent(new Event("load"));
		expect(s.extract).not.toHaveBeenCalled();
		expect(s.apply).not.toHaveBeenCalled();
	});
	it("does not save a failure as the poster's permanent color", () => {
		const s = setup(); s.extract.mockReturnValue(null as unknown as string); s.run();
		s.img.dispatchEvent(new Event("load"));
		expect(s.storage.setItem).not.toHaveBeenCalled();
		expect(s.apply).not.toHaveBeenCalled();
	});
	it("tolerates corrupt or unavailable storage", () => {
		const s = setup("not JSON"); s.run();
		s.storage.setItem.mockImplementation(() => { throw new Error("Quota"); });
		s.img.dispatchEvent(new Event("load"));
		expect(s.apply).toHaveBeenCalledWith("#abcdef");
	});
});
