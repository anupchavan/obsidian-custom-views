import { Setting, SettingGroup } from "obsidian";

/** Native groups on current hosts, ordinary heading rows on older versions. */
export function settingsGroup(container: HTMLElement, heading?: string, action?: { label: string; onClick: () => void }): HTMLElement {
	if (typeof SettingGroup === "function") {
		const group = new SettingGroup(container);
		if (heading) group.setHeading(heading);
		if (action) {
			group.addExtraButton(button => {
				button.setIcon("panels-top-left").onClick(action.onClick);
				// Keep the native icon, focus handling and click behavior; append only a label.
				button.extraSettingsEl.addClass("cv-labeled-extra-button");
				button.extraSettingsEl.appendText(action.label);
			});
		}
		return group.listEl;
	}
	if (heading) {
		const row = new Setting(container).setName(heading).setHeading();
		if (action) row.addButton(button => button.setButtonText(action.label).onClick(action.onClick));
	}
	return container;
}
