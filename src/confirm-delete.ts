import { App, ButtonComponent, ConfirmationModal, Modal, requireApiVersion } from "obsidian";

/** Use the host's confirmation dialog, with its standard modal fallback. */
export function confirmDelete(app: App, name: string, remove: () => void): Modal {
	const describe = (modal: Modal) => {
		modal.setTitle("Delete view");
		modal.contentEl.createEl("p", {
			text: `Delete “${name}” and its templates? This cannot be undone. Your notes will not be deleted.`,
		});
	};
	if (requireApiVersion("1.13.0")) {
		const modal = new ConfirmationModal(app);
		describe(modal);
		modal.addButton(button => button.setButtonText("Delete").setDestructive().setCta().onClick(remove));
		modal.addCancelButton();
		return modal;
	} else {
		const modal = new Modal(app);
		describe(modal);
		const buttons = modal.contentEl.createDiv("modal-button-container");
		const button = new ButtonComponent(buttons).setButtonText("Delete").onClick(() => {
			modal.close();
			remove();
		});
		// This is the supported destructive primary action on pre-1.13 hosts.
		const legacy: { setWarning(): unknown } = button;
		legacy.setWarning();
		new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => modal.close());
		return modal;
	}
}
