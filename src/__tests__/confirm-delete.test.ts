import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ modern: true }));
vi.mock("obsidian", () => {
	class ButtonComponent {
		buttonEl: HTMLButtonElement;
		constructor(container: HTMLElement) {
			this.buttonEl = document.createElement("button"); container.append(this.buttonEl);
		}
		setButtonText(text: string) { this.buttonEl.textContent = text; return this; }
		setDestructive() { this.buttonEl.classList.add("mod-destructive"); return this; }
		setCta() { this.buttonEl.classList.add("mod-cta"); return this; }
		setWarning() { return this.setDestructive().setCta(); }
		onClick(callback: () => void) { this.buttonEl.onclick = callback; return this; }
	}
	class Modal {
		contentEl = document.createElement("div");
		constructor() {
			Object.assign(this.contentEl, {
				createEl: (tag: string, options: { text: string }) => {
					const el = document.createElement(tag); el.textContent = options.text;
					this.contentEl.append(el); return el;
				},
				createDiv: (cls: string) => {
					const el = document.createElement("div"); el.className = cls;
					this.contentEl.append(el); return el;
				},
			});
		}
		setTitle() { return this; }
		open() { document.body.append(this.contentEl); }
		close() { this.contentEl.remove(); }
	}
	class ConfirmationModal extends Modal {
		addButton(callback: (button: ButtonComponent) => void) {
			const button = new ButtonComponent(this.contentEl);
			callback(button); button.buttonEl.addEventListener("click", () => this.close()); return this;
		}
		addCancelButton() { new ButtonComponent(this.contentEl).setButtonText("Cancel").onClick(() => this.close()); }
	}
	return { ButtonComponent, Modal, ConfirmationModal, requireApiVersion: () => host.modern };
});
import { confirmDelete } from "../confirm-delete";
import type { App } from "obsidian";

beforeEach(() => document.body.replaceChildren());
describe.each([true, false])("delete confirmation, modern=%s", modern => {
	it("waits for confirmation and uses a destructive primary action", () => {
		host.modern = modern; const remove = vi.fn();
		const modal = confirmDelete({} as App, "<script>Example</script>", remove); modal.open();
		expect(remove).not.toHaveBeenCalled();
		expect(modal.contentEl.querySelector("script")).toBeNull();
		expect(modal.contentEl.textContent).toContain("<script>Example</script>");
		const button = modal.contentEl.querySelector<HTMLButtonElement>(".mod-destructive.mod-cta")!;
		button.click();
		expect(remove).toHaveBeenCalledOnce();
	});
	it("does not delete on Cancel or dismissal", () => {
		host.modern = modern; const remove = vi.fn();
		const modal = confirmDelete({} as App, "Example", remove); modal.open();
		const cancel = [...modal.contentEl.querySelectorAll("button")].find(button => button.textContent === "Cancel")!;
		cancel.click(); modal.close();
		expect(remove).not.toHaveBeenCalled();
	});
});
