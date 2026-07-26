import { App, PluginSettingTab, Setting, SettingGroup, setIcon, Platform } from "obsidian";
import ObsidianRuleEnginePlugin from "./main";
import { RuleConfig, FilterGroup, CommandWithSetup, CommandSaveFn } from "./types";
import { DEFAULT_RULES } from "./consts";
import { EditRuleModal } from "editRuleModal";
export class ObsidianRuleEngineSettingTab extends PluginSettingTab {
	plugin: ObsidianRuleEnginePlugin;
	private draggedElement: HTMLElement | null = null;
	private draggedIndex: number | null = null;
	private activeTab: "rules" | "settings" | "commands" = "rules";

	constructor(app: App, plugin: ObsidianRuleEnginePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	get ruleCount(): number {
		return this.plugin.settings.rules.length ?? 0;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderTabBar(containerEl);

		switch (this.activeTab) {
			case "rules":
				this.renderRulesTab(containerEl);
				break;
			case "settings":
				this.renderSettingsTab(containerEl);
				break;
			case "commands":
				this.renderCommandConfigTab(containerEl);
				break;
		}
	}

	private renderTabBar(containerEl: HTMLElement): void {
		const tabs: { id: "rules" | "settings" | "commands"; label: string }[] = [
			{ id: "rules", label: "Rules" },
			{ id: "settings", label: "Settings" },
			{ id: "commands", label: "Command configuration" },
		];

		const tabHeaderContainer = containerEl.createDiv({ cls: "workspace-tab-header-container ore-settings-tab-bar" });
		const tabHeaderContainerInner = tabHeaderContainer.createDiv({ cls: "workspace-tab-header-container-inner" });

		tabs.forEach(tab => {
			const isActive = this.activeTab === tab.id;
			const header = tabHeaderContainerInner.createDiv({
				cls: "workspace-tab-header" + (isActive ? " is-active" : ""),
			});
			header.setAttribute("role", "tab");
			header.setAttribute("aria-selected", String(isActive));
			header.setAttribute("aria-label", tab.label);
			header.setAttribute("tabindex", "0");

			const inner = header.createDiv({ cls: "workspace-tab-header-inner" });
			inner.createDiv({ cls: "workspace-tab-header-inner-title", text: tab.label });

			header.onclick = () => {
				this.activeTab = tab.id;
				this.display();
			};
		});
	}

	private renderRulesTab(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setHeading()
			.setName("Rule configuration")
			.setDesc("Rules are checked and executed in order from top to bottom. The first matching template will be used. Commands from all matching rules will execute. Drag to reorder.")
			.addButton(btn => btn
				.setButtonText("Add new rule")
				.setCta()
				.onClick(async () => {
					const newRule: RuleConfig = {
						id: `${Date.now()}`,
						name: `Rule ${this.ruleCount + 1}`,
						filterGroup: JSON.parse(JSON.stringify(DEFAULT_RULES)) as FilterGroup,
						template: "<h1>{{file.basename}}</h1>",
						enabled: true,
						commandIds: [],
						baseFileHandling: "file"
					};
					this.plugin.settings.rules.push(newRule);
					await this.plugin.saveSettings();
					this.display();

					const newIndex = this.plugin.settings.rules.length - 1;
					new EditRuleModal(this.app, this.plugin, newRule, newIndex, () => {
						this.display();
					}).open();
				}));

		const ruleListContainer = containerEl.createDiv({ cls: "ore-rules-list-container" });

		this.plugin.settings.rules.forEach((rule, index) => {
			this.renderRuleListItem(ruleListContainer, rule, index);
		});
	}

	private renderSettingsTab(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Enabled")
			.setDesc("Enable rule automations")
			.addToggle(toggle => toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
				this.plugin.settings.enabled = value;
				await this.plugin.saveSettings();
			}));

		const addReadingModeSetting = (setting: Setting) => {
			setting
				.setName("Template in live preview")
				.setDesc("Enable to use templates in both live preview and reading view. Disable to limit them to reading view only.")
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.workInLivePreview)
					.onChange(async (value) => {
						this.plugin.settings.workInLivePreview = value;
						await this.plugin.saveSettings();
						const file = this.app.workspace.getActiveFile();
						if (file) {
							this.plugin.processMarkdownView(file).catch((e) => {
								this.plugin.debug(e);
							});
						}
					}));
		};
		const addCanvasSetting = (setting: Setting) => {
			setting
				.setName("Template in canvas (experimental)")
				.setDesc("Apply templates to Markdown file nodes in canvas files")
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.workInCanvas)
					.onChange(async (value) => {
						this.plugin.settings.workInCanvas = value;
						await this.plugin.saveSettings();
						if (value) {
							this.plugin.processAllCanvasNodes();
						} else {
							this.plugin.restoreAllCanvasNodes();
						}
					}));
		};

		const addProcessOnSave = (setting: Setting) => {
			setting
				.setName("Process on settings change")
				.setDesc("Trigger processing of rule engine results when plugin settings or rules change.")
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.processOnSave)
					.setDisabled(!this.plugin.isBasesViewRegistered)
					.setTooltip(this.plugin.isBasesViewRegistered ? '' : 'Rule engine view could not be registered')
					.onChange(async (value) => {
						this.plugin.settings.processOnSave = value;
						await this.plugin.saveSettings();
					}));
		};

		const addBaseSetting = (setting: Setting) => {
			setting
				.setName("Process .base files automatically")
				.setDesc("Allow rules to execute across the 'rule engine' view in .base files automatically when data changes.")
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.processBaseResultsAutomatically)
					.setDisabled(!this.plugin.isBasesViewRegistered)
					.setTooltip(this.plugin.isBasesViewRegistered ? '' : 'Rule engine view could not be registered')
					.onChange(async (value) => {
						this.plugin.settings.processBaseResultsAutomatically = value;
						await this.plugin.saveSettings();
					}));
		};

		const addUseDnd = (setting: Setting) => {
			setting
				.setName("Drag and drop")
				.setDesc("Use drag and drop in lists when your device supports it.")
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.useDnd)
					.onChange(async (value) => {
						this.plugin.settings.useDnd = value;
						await this.plugin.saveSettings();
						this.display();
					}));
		}

		const addDebug = (setting: Setting) => {
			setting
				.setName("Debug")
				.setDesc("Log debug messages to the developer tools")
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.debug)
					.onChange(async (value) => {
						this.plugin.settings.debug = value;
						await this.plugin.saveSettings();
						this.display();
					}));
		};

		const settingsGroup = new SettingGroup(containerEl).setHeading('Settings');
		settingsGroup.addSetting(addReadingModeSetting);
		settingsGroup.addSetting(addCanvasSetting);
		settingsGroup.addSetting(addProcessOnSave);
		settingsGroup.addSetting(addBaseSetting);
		if (!Platform.isMobile) {
			settingsGroup.addSetting(addUseDnd);
		}
		settingsGroup.addSetting(addDebug);
	}

	private renderCommandConfigTab(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setHeading()
			.setName("Command configuration")
			.setDesc("Any command in Obsidian can be used in rules. Configuration of rule engine commands is shared across all rules.");

		const commandConfigContainer = containerEl.createDiv({ cls: "ore-rules-list-container" });

		this.plugin.commands.sort((a, b) => {
			return a.name.localeCompare(b.name);
		}).forEach(cmdConfig => {
			this.renderCommandConfigListItem(commandConfigContainer, cmdConfig);
		});
	}

	renderRuleListItem(container: HTMLElement, rule: RuleConfig, index: number) {
		const ruleCount = this.plugin.settings.rules.length;
		const listItem = container.createDiv({ cls: "ore-rule-list-item" });
		listItem.setAttribute("data-rule-id", rule.id);
		listItem.setAttribute("data-rule-index", index.toString());
		listItem.setAttribute("data-rule-enabled", String(rule.enabled));
		// only show drag controls on desktop and when supported, it does not work well on mobile
		listItem.draggable = this.plugin.settings.useDnd && Platform.isDesktop && 'ondragstart' in listItem && ruleCount > 1;

		const itemTitle = [
			rule.name,
			'|',
			`☰ ${rule.commandIds.length}`,
			rule.template?.length ? `🗎` : '🗋'
		].filter(str => Boolean(str?.length))
			.join(" "); // em space
		listItem.createSpan({ cls: "ore-rule-name", text: itemTitle });

		const actionsContainer = listItem.createDiv({ cls: "ore-rule-actions" });

		const editBtn = actionsContainer.createDiv({ cls: "clickable-icon" });
		setIcon(editBtn, "pencil");
		editBtn.setAttribute("aria-label", "Edit rule");
		editBtn.onclick = (e) => {
			e.stopPropagation();
			new EditRuleModal(this.app, this.plugin, rule, index, () => {
				this.display();
			}).open();
		};

		const deleteBtn = actionsContainer.createDiv({ cls: "clickable-icon" });
		setIcon(deleteBtn, "trash-2");
		deleteBtn.setAttribute("aria-label", "Delete rule");
		deleteBtn.onclick = async (e) => {
			e.stopPropagation();
			this.plugin.settings.rules.splice(index, 1);
			await this.plugin.saveSettings();
			this.display();
		};

		const moveItem = (fromIndex: number, toIndex: number) => {
			this.plugin.debug(`moveItem`, fromIndex, toIndex);
			if (fromIndex < 0) return;
			toIndex = Math.max(0, Math.min(toIndex, this.plugin.settings.rules.length - 1));

			const rule = this.plugin.settings.rules.splice(fromIndex, 1)?.[0];
			this.plugin.debug(`rule`, rule);
			this.plugin.settings.rules.splice(toIndex, 0, rule!);
			void this.plugin.saveSettings();
			this.display();
		}

		if (ruleCount > 1) {
			if (listItem.draggable) {
				const dragHandle = listItem.createDiv({ cls: "ore-rule-drag-handle" });
				setIcon(dragHandle, "grip-vertical");

				listItem.addEventListener("dragstart", (e) => {
					if (!e.dataTransfer) return;
					e.dataTransfer.effectAllowed = "move";
					this.draggedElement = listItem;
					this.draggedIndex = index;
					listItem.addClass("ore-dragging");
					container.querySelectorAll(".ore-rule-list-item").forEach((el) => {
						el.removeClass("ore-drag-over");
					});
				});

				listItem.addEventListener("dragend", () => {
					listItem.removeClass("ore-dragging");
					container.querySelectorAll(".ore-rule-list-item").forEach((el) => {
						el.removeClass("ore-drag-over");
					});
					this.draggedElement = null;
					this.draggedIndex = null;
				});

				listItem.addEventListener("dragover", (e) => {
					e.preventDefault();
					if (!e.dataTransfer || !this.draggedElement || this.draggedIndex === null) return;
					e.dataTransfer.dropEffect = "move";

					if (listItem === this.draggedElement) return;

					listItem.addClass("ore-drag-over");
				});

				listItem.addEventListener("dragleave", () => {
					listItem.removeClass("ore-drag-over");
				});

				listItem.addEventListener("drop", (e) => {
					e.preventDefault();
					if (!e.dataTransfer || !this.draggedElement || this.draggedIndex === null) return;

					if (listItem === this.draggedElement) {
						listItem.removeClass("ore-drag-over");
						return;
					}

					const draggedRule = this.plugin.settings.rules[this.draggedIndex];
					const allItems = Array.from(container.querySelectorAll(".ore-rule-list-item"));
					const targetIndex = allItems.indexOf(listItem);

					if (targetIndex === -1) return;

					this.plugin.settings.rules.splice(this.draggedIndex, 1);
					this.plugin.settings.rules.splice(targetIndex, 0, draggedRule!);

					void this.plugin.saveSettings();
					this.display();
				});
			} else {
				listItem.createEl('input', { cls: "ore-rule-move-input" }, (inputEl) => {
					inputEl.dataset.idx = String(index);
					inputEl.type = "number";
					inputEl.min = String(1);
					inputEl.max = String(this.plugin.settings.rules.length);
					inputEl.style = "width: min-content;"
					inputEl.value = String(index + 1);
					inputEl.addEventListener("change", _evt => {
						this.plugin.debug(_evt, inputEl);
						if (inputEl.value) {
							const oldIdx = Number(inputEl.dataset.idx);
							this.plugin.debug({ inputEl, oldIdx, newIdx: Number(inputEl.value) });
							moveItem(oldIdx, Number(inputEl.value) - 1);
							inputEl.dataset.idx = inputEl.value;
						}
					});
				});
			}
		} else {
			this.plugin.debug("no rules to execute");
		}
	}

	renderCommandConfigListItem(container: HTMLElement, cmdConfig: CommandWithSetup) {
		const { id, name, description, settingCallback } = cmdConfig;
		const currentConfig = this.plugin.getCommandConfig(id);
		const cmdGroup = new SettingGroup(container)
		cmdGroup.addSetting(setting => {
			setting
				.setName(name)
				.setDesc('Enabled')
				.setDesc(description ?? '')
				.setTooltip('Toggle whether or not this command appears in the Obsidian palette and can be used in rules')
				.addToggle(toggle => toggle
					.setValue(currentConfig.enabled)
					.onChange(async (value) => {
						currentConfig.enabled = value;
						await this.plugin.updateCommandConfig(id, { enabled: value }).catch(e => this.plugin.debug(e));
					}));
			setting.nameEl.className = 'ore-command-config-name';
		});
		if (settingCallback) {
			const saveFn: CommandSaveFn = async (updatedConfig) => {
				if (updatedConfig.enabled !== undefined) currentConfig.enabled = updatedConfig.enabled;
				if (updatedConfig.params) Object.assign(currentConfig.params, updatedConfig.params);
				await this.plugin.updateCommandConfig(id, updatedConfig);
			};
			settingCallback(cmdGroup, currentConfig, saveFn);
		}
	}
}