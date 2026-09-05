import type { App, TFile } from "obsidian";

/** Retain unresolved links so creating their destination can refresh an open template. */
export class TemplateDependencies extends Set<TFile> {
	private missingLinks = new Map<string, { target: string; sourcePath: string }>();
	constructor(private app: App) { super(); }
	addMissingLink(target: string, sourcePath: string): void {
		this.missingLinks.set(JSON.stringify([target, sourcePath]), { target, sourcePath });
	}
	override has(file: TFile): boolean {
		if (super.has(file)) return true;
		for (const { target, sourcePath } of this.missingLinks.values()) {
			if (this.app.metadataCache.getFirstLinkpathDest(target, sourcePath) === file) return true;
		}
		return false;
	}
}

export function recordLinkDependency(dependencies: Set<TFile> | undefined, target: string, sourcePath: string, file: TFile | null): void {
	if (file) dependencies?.add(file);
	else if (dependencies instanceof TemplateDependencies) dependencies.addMissingLink(target, sourcePath);
}
