import { Setting, SettingGroup } from "obsidian";

/** Native groups on current hosts, ordinary heading rows on older versions. */
export function settingsGroup(container: HTMLElement, heading?: string): HTMLElement {
	if (typeof SettingGroup === "function") {
		const group = new SettingGroup(container);
		if (heading) group.setHeading(heading);
		return group.listEl;
	}
	if (heading) new Setting(container).setName(heading).setHeading();
	return container;
}
