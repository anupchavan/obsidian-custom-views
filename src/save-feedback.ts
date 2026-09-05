import { Notice } from "obsidian";

/** Keep failed autosaves visible and offer a retry of the current in-memory settings. */
export class SaveFeedback {
	private notice?: Notice;
	constructor(private retry: () => Promise<void>) {}
	failed(error: unknown): void {
		if (this.notice?.containerEl.isConnected) return;
		console.error("[Custom Views] Could not save settings:", error);
		const message = activeDocument.createDocumentFragment();
		const text = activeDocument.createElement("div");
		text.textContent = "Could not save your view settings. Your edits are still in memory; retry before reloading Obsidian.";
		const button = activeDocument.createElement("button");
		button.textContent = "Retry saving";
		button.type = "button";
		button.addEventListener("click", event => {
			event.stopPropagation();
			if (button.disabled) return;
			button.disabled = true;
			void this.retry().catch(() => {}).finally(() => { button.disabled = false; });
		});
		message.append(text, button);
		this.notice = new Notice(message, 0);
	}
	clear(): void {
		this.notice?.hide();
		this.notice = undefined;
	}
}
