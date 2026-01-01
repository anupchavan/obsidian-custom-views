import { Plugin, TFile, MarkdownView, Keymap, Notice } from "obsidian";
import { CustomViewsSettings, DEFAULT_SETTINGS, CustomViewsSettingTab } from "./settings";
import { checkRules } from "./matcher";
import { renderTemplate } from "./renderer";

const CUSTOM_VIEW_CLASS = "obsidian-custom-view-render";
const HIDE_MARKDOWN_CLASS = "obsidian-custom-view-hidden";

export default class CustomViewsPlugin extends Plugin {
	settings: CustomViewsSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CustomViewsSettingTab(this.app, this));

		this.addCommand({
			id: "enable",
			name: "Enable",
			checkCallback: (checking) => {
				if (checking) {
					return !this.settings.enabled;
				}

				void this.setPluginState(true);
				return true;
			},
		});

		this.addCommand({
			id: "disable",
			name: "Disable",
			checkCallback: (checking) => {
				if (checking) {
					return this.settings.enabled;
				}

				void this.setPluginState(false);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => this.processActiveView(file))
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				const file = this.app.workspace.getActiveFile();

				void this.processActiveView(file);
			})
		);
	}

	async setPluginState(enabled: boolean) {
		this.settings.enabled = enabled;
		await this.saveSettings();

		new Notice(enabled ? "Custom Views Enabled" : "Custom Views Disabled");

		const file = this.app.workspace.getActiveFile();

		if (file) {
			void this.processActiveView(file);
		}
	}

	onunload() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				this.restoreDefaultView(leaf.view);
			}
		});
	}

	async processActiveView(file: TFile | null) {
		if (!file) return;

		const leaf = this.app.workspace.getLeaf(false);
		if (!(leaf.view instanceof MarkdownView)) return;

		const view = leaf.view;

		if (!this.settings.enabled) {
			this.restoreDefaultView(view);
			return;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		let matchedTemplate = "";

		for (const viewConfig of this.settings.views) {
			const isMatch = checkRules(this.app, viewConfig.rules, file, cache?.frontmatter);
			if (isMatch) {
				matchedTemplate = viewConfig.template;
				break;
			}
		}

		if (!matchedTemplate) {
			this.restoreDefaultView(view);
			return;
		}

		const state = view.getState();
		const isTrueSourceMode = state.mode === 'source' && state.source === true;
		const isReadingMode = state.mode === 'preview';
		const isLivePreviewMode = state.mode === 'source' && state.source === false;

		if (isTrueSourceMode) {
			this.restoreDefaultView(view);
			return;
		}

		if (!this.settings.workInLivePreview && !isReadingMode) {
			this.restoreDefaultView(view);
			return;
		} else if (!isReadingMode && !isLivePreviewMode) {
			this.restoreDefaultView(view);
			return;
		}

		await this.injectCustomView(view, file, matchedTemplate);
	}

	async injectCustomView(view: MarkdownView, file: TFile, template: string) {
		const container = view.contentEl;
		let customEl = container.querySelector(`.${CUSTOM_VIEW_CLASS}`) as HTMLElement;

		if (!customEl) {
			customEl = document.createElement("div");
			customEl.addClass(CUSTOM_VIEW_CLASS);
			container.appendChild(customEl);

			this.registerDomEvent(customEl, "click", (evt: MouseEvent) => {
				const target = evt.target as HTMLElement;
				const link = target.closest(".internal-link");

				if (link && link instanceof HTMLAnchorElement) {
					evt.preventDefault();
					const href = link.getAttribute("data-href") || link.getAttribute("href");

					if (href) {
						const newLeaf = Keymap.isModEvent(evt);
						void this.app.workspace.openLinkText(href, file.path, newLeaf);
					}
				}
			});
		}

		await renderTemplate(this.app, template, file, customEl, this);
		container.addClass(HIDE_MARKDOWN_CLASS);
	}

	restoreDefaultView(view: MarkdownView) {
		const container = view.contentEl;
		container.removeClass(HIDE_MARKDOWN_CLASS);
		const customEl = container.querySelector(`.${CUSTOM_VIEW_CLASS}`);
		if (customEl) customEl.remove();
	}

	async loadSettings() {
		const loadedData = await this.loadData() as Partial<CustomViewsSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
