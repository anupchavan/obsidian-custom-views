import { TFolder } from "obsidian";

/** A folder fixture; the vault root is "/", as in Obsidian. */
export function folder(path: string): TFolder {
	return Object.assign(new TFolder(), { path, isRoot: () => path === "/" });
}
