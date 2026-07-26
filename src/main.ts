import { Plugin, TFile, MarkdownView, Keymap, Notice, WorkspaceLeaf, Command } from "obsidian";
import { ObsidianRuleEngineSettingTab } from "./settings";
import { checkRules } from "./matcher";
import { renderTemplate } from "./templateRenderer";
import { CUSTOM_RULE_CLASS, DEFAULT_SETTINGS, HIDE_MARKDOWN_CLASS, TYPE_ICONS } from "./consts";
import { BaseFileHandling, CanvasNode, CanvasView, CommandConfig, CommandWithSetup, CustomRulesSettings, ProcessMarkdownViewOptions, PropertyDef, PropertyType } from "./types";
import { list as commandList } from './commands';
import { RULE_ENGINE_BASE_VIEW_ID, RuleEngineBasesView } from "ruleEngineBasesView";
import { getRuleEngineViewOptions } from "ruleEngineBasesViewOptions";
/**
 * Type guard to check if a view is a canvas view
 */
function isCanvasView(view: unknown): view is CanvasView {
	return typeof view === "object" && view !== null && "canvas" in view;
}

/**
 * Strips the "plugin-id:" prefix Obsidian adds to command ids, so overrides
 * keyed by either the full id or the short id can both be looked up.
 */
function stripCommandIdPrefix(id: string): string {
	return id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
}
export default class ObsidianRuleEnginePlugin extends Plugin {
	settings: CustomRulesSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as CustomRulesSettings;
	// Per-call command overrides set inside doCmds() and restored after — safe because
	// JS is single-threaded: each doCmds() runs to completion before the next starts.
	private _callOverrides: Record<string, Partial<CommandConfig>> = {};

	debug(...args: unknown[]) {
		if (this.settings.debug) {
			console.debug(...args);
		}
		if (args[0] instanceof Error) {
			const msg = '⛔ ' + args[0].message?.length ? args[0].message : args[0].name;
			console.error(...args);
			new Notice(msg);
		}
	}

	get commands(): CommandWithSetup[] {
		return commandList.map(fn => fn(this));
	};

	/**
	 * 
	 * @param id The command ID
	 * @returns The command config from the plugin data.json
	 */
	getCommandConfig = <T extends Record<string, unknown>>(id: string): CommandConfig<T> => {
		const existing = this.settings.commands?.[id] as CommandConfig<T> | undefined;
		const base: CommandConfig<T> = { enabled: false, params: {} as T, ...existing };
		const shortId = stripCommandIdPrefix(id);
		const override = this._callOverrides[id] ?? this._callOverrides[shortId];
		if (!override) return base;
		return {
			...base,
			...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
			params: { ...base.params, ...(override.params ?? {}) } as T,
		};
	};

	getFileCommandOverrides(file: TFile): Record<string, Partial<CommandConfig>> {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter) return {};
		const overrides: Record<string, Partial<CommandConfig>> = {};
		for (const key of Object.keys(frontmatter)) {
			// ore:[cmd-id]:[setting]
			const match = /^ore:(.+):([^:]+)$/.exec(key);
			if (!match) continue;
			const [, cmdId, setting] = match;
			if (!cmdId || !setting) continue;
			if (!overrides[cmdId]) overrides[cmdId] = {};
			const value = frontmatter[key] as unknown;
			if (setting === 'enabled') {
				overrides[cmdId].enabled = value === true || value === 'true' || value === 1;
			} else {
				if (!overrides[cmdId].params) overrides[cmdId].params = {};
				(overrides[cmdId].params)[setting] = value;
			}
		}
		return overrides;
	};

	/**
	 * 
	 * @param id The command ID
	 * @param partialUpdate An object containing some settings to update in the plugin data.json
	 */
	updateCommandConfig = async <T extends Record<string, unknown>>(id: string, partialUpdate: Partial<CommandConfig<T>>): Promise<void> => {
		this.settings.commands = this.settings.commands || {};

		const existing = this.getCommandConfig<T>(id);
		const fullConfig: CommandConfig<T> = {
			...existing,
			...partialUpdate,
			params: {
				...existing.params,
				...(partialUpdate.params || {})
			}
		};
		this.settings.commands[id] = fullConfig as unknown as CommandConfig;

		await this.saveSettings().catch(reason => {
			this.debug(reason);
			throw new Error(`failed to update command config`);
		});
	};

	public isBasesViewRegistered: boolean = false;
	public activeBasesView: RuleEngineBasesView | undefined = undefined;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ObsidianRuleEngineSettingTab(this.app, this));

		if (!this.isBasesViewRegistered) {
			this.debug(`registerBasesView`);
			this.isBasesViewRegistered = this.registerBasesView(RULE_ENGINE_BASE_VIEW_ID, {
				name: 'Rule Engine', // Display name in view selector
				icon: 'terminal', // Lucide icon name
				factory: (controller, containerEl) => new RuleEngineBasesView(controller, containerEl, this),
				options: getRuleEngineViewOptions // Optional: user-configurable options function
			});
		};

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

		for (const cmd of this.commands) {
			try {
				if ('description' in cmd) {
					delete cmd.description;
				}
				if ('settingCallback' in cmd) {
					delete cmd.settingCallback
				}
				const cmdObject: Command = {
					...cmd,
				};
				//ensure the commands always go through an enabled check
				delete cmdObject.callback;
				delete cmdObject.editorCallback;
				delete cmdObject.checkCallback;
				delete cmdObject.editorCheckCallback;

				if (cmd.callback || cmd.checkCallback) {
					cmdObject.checkCallback = (checking: boolean): boolean | void => {
						if (checking) {
							const enabled = this.getCommandConfig(cmd.id)?.enabled;
							if (enabled && cmd.checkCallback) {
								return cmd.checkCallback(checking);
							}
							return enabled;
						}
						if (cmd.checkCallback) {
							return cmd.checkCallback(checking);
						}
						cmd.callback?.();
					};
				}

				if (cmd.editorCallback || cmd.editorCheckCallback) {
					cmdObject.editorCheckCallback = (checking, editor, ctx) => {
						if (checking) {
							const enabled = this.getCommandConfig(cmd.id)?.enabled;
							if (enabled && cmd.editorCheckCallback) {
								return cmd.editorCheckCallback(checking, editor, ctx);
							}
							return enabled;
						}
						if (cmd.editorCheckCallback) {
							return cmd.editorCheckCallback(checking, editor, ctx);
						}
						cmd.editorCallback?.(editor, ctx);
					};
				}
				this.debug(`adding command`, cmdObject.id, cmdObject);
				this.addCommand(cmdObject);
			} catch (e) {
				this.debug(e, `couldn't add command`, cmd);
			}
		}

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => this.processMarkdownView(file, {
				skipCommandExecution: true
			}))
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				const file = this.app.workspace.getActiveFile();

				void this.processMarkdownView(file, {
					skipCommandExecution: false
				});
				if (this.settings.workInCanvas) {
					void this.processAllCanvasNodes();
				}
			})
		);

		// Process canvas nodes when canvas changes
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (this.settings.workInCanvas) {
					void this.processAllCanvasNodes();
				}
			})
		);

		// Also process canvas nodes periodically to catch updates
		this.registerInterval(window.setInterval(() => {
			if (this.settings.enabled && this.settings.workInCanvas) {
				this.debug(`canvas node interval`);
				void this.processAllCanvasNodes();
			}
		}, 10000));
	}

	async setPluginState(enabled: boolean) {
		this.settings.enabled = enabled;
		await this.saveSettings();

		const msg = enabled ? "Rule Engine Enabled" : "Rule Engine Disabled";
		new Notice(msg);
		this.debug(msg);

		const file = this.app.workspace.getActiveFile();

		if (file) {
			void this.processMarkdownView(file);
		}
	}

	onunload() {
		this.debug(`onunload`);
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				this.restoreDefaultView(leaf.view);
			}
		});
		// Clean up canvas nodes
		this.restoreAllCanvasNodes();
	}

	extractMatchingRuleParameters = (file: TFile, options?: ProcessMarkdownViewOptions) => {
		const cache = this.app.metadataCache.getFileCache(file);
		const useBaseFileHandling: BaseFileHandling = options?.baseFileHandling ?? "file";
		let matchedTemplate = "";
		let commandIds: string[] = [];

		const ruleLog = this.settings.debug ? (...args: unknown[]) => this.debug(...args) : undefined;
		for (const [ruleIndex, ruleConfig] of this.settings.rules.entries()) {
			//default to file baseFileHandling
			const matchingBaseHandling = ruleConfig.baseFileHandling === "both" || ruleConfig.baseFileHandling === useBaseFileHandling;
			const isMatch = ruleConfig.enabled && matchingBaseHandling && checkRules(this.app, ruleConfig.filterGroup, file, cache?.frontmatter, ruleLog);
			this.debug(`Rule [${ruleIndex}] "${ruleConfig.name ?? ""}" on "${file.path}": ${isMatch ? "MATCH" : "no match"}${!ruleConfig.enabled ? " (disabled)" : !matchingBaseHandling ? " (wrong base handling)" : ""}`);
			if (isMatch) {
				if (!matchedTemplate.length) {
					const ctx = options?.renderContext;
					if (ctx === 'canvas' && ruleConfig.templateCanvas?.trim()) {
						matchedTemplate = ruleConfig.templateCanvas;
					} else if (ctx === 'base' && ruleConfig.templateBase?.trim()) {
						matchedTemplate = ruleConfig.templateBase;
					} else {
						matchedTemplate = ruleConfig.template;
					}
				}
				if (!options?.skipCommandExecution) {
					commandIds = [...commandIds, ...ruleConfig.commandIds];
				}
			}
		}

		const forcedTemplate = options?.forceTemplateIndex === undefined ? undefined : this.settings.rules[options?.forceTemplateIndex]?.template?.trim();

		const result = {
			matchedTemplate: forcedTemplate ?? matchedTemplate,
			commandIds,
			baseFileHandling: useBaseFileHandling
		};

		this.debug(`extractMatchingRuleParameters`, result);

		return result;
	};

	async processMarkdownView(file: TFile | null, options?: ProcessMarkdownViewOptions) {
		if (!file) return;

		const leaf = this.app.workspace.getLeaf(false);

		if (!(leaf.view instanceof MarkdownView)) return;

		const view = leaf.view;

		if (!this.settings.enabled) {
			this.restoreDefaultView(view);
			this.debug(`processMarkdownView`, `plugin not enabled`);
			return;
		}

		const { matchedTemplate, commandIds, baseFileHandling } = this.extractMatchingRuleParameters(file, options);

		if (!options?.skipCommandExecution) {
			this.executeCommands(baseFileHandling, commandIds, null, undefined, this.getFileCommandOverrides(file));
		}

		if (!matchedTemplate) {
			this.restoreDefaultView(view);
			this.debug(`processMarkdownView`, `no matching template`);
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

		await this.injectCustomView(view.contentEl, file, matchedTemplate);
	}

	async injectCustomView(container: HTMLElement, file: TFile, template: string) {
		let customEl = container.querySelector(`.${CUSTOM_RULE_CLASS}`) as HTMLElement;

		if (!customEl) {
			customEl = activeDocument.createElement("div");
			customEl.addClass(CUSTOM_RULE_CLASS);
			container.appendChild(customEl);

			this.debug(`injectCustomView`, `new customEl`, customEl);
			this.registerDomEvent(customEl, "click", (evt: MouseEvent) => {
				const target = evt.target as HTMLElement;
				const link = target.closest(".internal-link");

				if (link && link.instanceOf(HTMLAnchorElement)) {
					evt.preventDefault();
					const href = link.getAttribute("data-href") || link.getAttribute("href");

					if (href) {
						const newLeaf = Keymap.isModEvent(evt);
						void this.app.workspace.openLinkText(href, file.path, newLeaf);
					}
				}
			});
		}

		this.debug(`injectCustomView`, `rendering template`);
		await renderTemplate(this.app, template, file, customEl, this);
		container.addClass(HIDE_MARKDOWN_CLASS);
	}

	restoreDefaultView(view: MarkdownView) {
		const container = view.contentEl;
		container.removeClass(HIDE_MARKDOWN_CLASS);
		const customEl = container.querySelector(`.${CUSTOM_RULE_CLASS}`);
		this.debug(`restoring default view`);
		if (customEl) customEl.remove();
	}

	async loadSettings() {
		const loadedData = await this.loadData() as Partial<CustomRulesSettings> | null;
		this.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), loadedData || {}) as CustomRulesSettings;

		// Ensure all available commands are initialized in settings
		this.settings.commands = this.settings.commands || {};
		for (const cmdFn of commandList) {
			const cmd = cmdFn(this);
			this.settings.commands[cmd.id] = this.getCommandConfig(cmd.id);
		}

		await this.saveSettings();

		this.debug(`loaded settings`);
	}

	async saveSettings() {
		this.debug(`saving settings`);
		if (this.activeBasesView && this.settings.processOnSave) {
			this.activeBasesView.processView(true);
		}
		await this.saveData(this.settings);
	}

	/**
	 * Process all markdown file nodes in canvas files
	 */
	processAllCanvasNodes() {
		if (!this.settings.enabled || !this.settings.workInCanvas) {
			this.restoreAllCanvasNodes();
			return;
		}

		this.debug(`processAllCanvasNodes`, `iterating leaves`);
		// Find all canvas views
		this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			const view = leaf.view;
			// Check if this is a canvas view (CanvasView type may not be exported, so we check by class)
			if (isCanvasView(view) && view.canvas) {
				const canvas = view.canvas;
				if (canvas.nodes) {
					// Process each node in the canvas
					this.debug(`processAllCanvasNodes`, `processing nodes`);
					canvas.nodes.forEach((node) => {
						if (node.file && node.file instanceof TFile && node.file.extension === "md") {
							void this.processCanvasNode(node);
						}
					});
				}
			}
		});
	}

	/**
	 * Process a single canvas node
	 */
	async processCanvasNode(node: CanvasNode) {
		const file = node.file;
		if (!(file instanceof TFile)) return;

		const {
			matchedTemplate,
			// commandIds, baseFileHandling
		} = this.extractMatchingRuleParameters(file, { renderContext: 'canvas' });

		// this.executeCommands(baseFileHandling, commandIds);

		if (!matchedTemplate) {
			this.restoreCanvasNode(node);
			return;
		}

		// Find the node's content element
		const nodeEl = node.nodeEl as HTMLElement;
		if (!nodeEl) return;

		// Find the markdown preview container within the node
		const previewContainer = nodeEl.querySelector(".markdown-preview-view") as HTMLElement;
		if (!previewContainer) return;

		await this.injectCustomView(previewContainer, file, matchedTemplate);
	}

	/**
	 * Restore a canvas node to default view
	 */
	restoreCanvasNode(node: CanvasNode) {
		const nodeEl = node.nodeEl as HTMLElement;
		if (!nodeEl) return;

		const previewContainer = nodeEl.querySelector(".markdown-preview-view") as HTMLElement;
		if (!previewContainer) return;

		this.debug(`restoreCanvasNode`);
		previewContainer.removeClass(HIDE_MARKDOWN_CLASS);
		const customEl = previewContainer.querySelector(`.${CUSTOM_RULE_CLASS}`);
		if (customEl) customEl.remove();
	}

	/**
	 * Restore all canvas nodes
	 */
	restoreAllCanvasNodes() {
		this.debug(`restoreAllCanvasNodes`, `iterating leaves`);
		this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			const view = leaf.view;
			if (isCanvasView(view) && view.canvas) {
				const canvas = view.canvas;
				if (canvas.nodes) {
					canvas.nodes.forEach((node) => {
						this.restoreCanvasNode(node);
					});
				}
			}
		});
	}

	public get obsidianCommands(): Record<string, Command> {
		const regularCommands = this.app.commands.commands;
		const editorCommands = this.app.commands.editorCommands;
		const allCommands: Record<string, Command> = { ...regularCommands, ...editorCommands };
		if (Object.keys(allCommands).length === 0) {
			this.debug('no commands found for rule-engine');
		} else {
			this.debug(`found ${Object.keys(allCommands).length} commands`, allCommands);
		}
		return allCommands;
	}

	public executeCommands(mode: BaseFileHandling, commandIds: string[], file?: TFile | null, groupLeaf?: WorkspaceLeaf, fileOverrides?: Record<string, Partial<CommandConfig>>): void {
		if (!commandIds?.length) return;
		this.debug(`executeCommands`, mode, commandIds.length, 'commands', { file, groupLeaf });
		const doCmds = () => {
			const prev = this._callOverrides;
			this._callOverrides = fileOverrides ?? {};
			try {
				const commandObjects = Object.entries(this.obsidianCommands).filter(([k]) => commandIds.includes(k)).map(([_, cmd]) => cmd);
				if (mode === "file" || mode === "both") {
					for (const cmd of commandObjects) {
						// Check per-file enabled override
						const shortId = stripCommandIdPrefix(cmd.id);
						const override = fileOverrides?.[cmd.id] ?? fileOverrides?.[shortId];
						if (override?.enabled === false) continue;
						const commandFn = cmd?.checkCallback ?? cmd?.callback ?? undefined;
						commandFn?.(false);
					}
				} else {
					this.debug(`commands not executed for mode:`, mode);
				}
			} finally {
				this._callOverrides = prev;
			}
		};
		if (file) {

			const leaf = this.app.workspace.getLeaf(
				groupLeaf ? undefined : "split",
				groupLeaf ? undefined : "vertical"
			);
			leaf.setGroup('ore-leaf-group');
			if (groupLeaf) {
				leaf.setGroupMember(groupLeaf);
			}
			leaf.openFile(file).then(() => {
				doCmds();
			}).catch(e => {
				this.debug(e);
			}).finally(() => {
				this.debug(`leaf command execution finished`);
			});
			return;
		} else {
			doCmds();
		}
	}

	inferType(val: unknown): PropertyType {
		if (val === null || val === undefined) return "unknown";
		if (Array.isArray(val)) return "list";
		if (typeof val === "number") return "number";
		if (typeof val === "boolean") return "checkbox";
		if (typeof val === "string") {
			if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return "date";
			if (/^\d{4}-\d{2}-\d{2}T/.test(val)) return "datetime";
		}
		return "text";
	}

	/**
	 * Scans the vault to find properties and INFER their types.
	 */
	scanVaultProperties(): PropertyDef[] {

		// Define built-in properties in the desired order
		const builtInProps: Array<[string, PropertyType]> = [
			["file", "file"],
			["file.name", "text"],
			["file.path", "text"],
			["file.folder", "text"],
			["file.ctime", "date"],
			["file.mtime", "date"],
			["file.size", "number"],
			["file.outlinks", "number"],
			["file.inlinks", "number"],
			["file tags", "list"],
			["aliases", "list"]
		];

		// init with built-in props
		const propMap = new Map<string, PropertyType>(builtInProps);

		// Scan frontmatter properties
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter) {
				for (const key of Object.keys(cache.frontmatter)) {
					if (key === "position" || key === "tags" || key === "aliases") continue;
					if (propMap.has(key) && propMap.get(key) !== "unknown") continue;
					const val = cache.frontmatter[key] as string | number | boolean | string[] | undefined;
					const type = this.inferType(val);
					propMap.set(key, type);
				}
			}
		}
		return Array.from(propMap.entries()).map(([key, type]) => ({ key, type }));
	}

	/**
	  * Gets the icon for a property
	  */
	getPropertyIcon(key: string, type: PropertyType): string {
		if (key === "file tags") return "tags";
		if (key === "aliases") return "forward";
		if (key === "file.ctime" || key === "file.mtime") return "clock";
		if (key === "file.outlinks") return "arrow-right";
		if (key === "file.inlinks") return "arrow-left";
		return TYPE_ICONS[type] || "pilcrow";
	}

	getPropertyType(key: string, allVaultProperties?: PropertyDef[]): PropertyType {
		// passing the property definitions here means the vault doesn't need to be searched again
		const props = allVaultProperties?.length
			? allVaultProperties
			: this.scanVaultProperties();
		const def = props.find(p => p.key === key);
		return def ? def.type : "text";
	}


	/**
	 * Gets the display label for a property key
	 */
	getPropertyLabel(key: string): string {
		const labelMap: Record<string, string> = {
			"file.name": "file name",
			"file.path": "file path",
			"file.folder": "folder",
			"file.size": "file size",
			"file.outlinks": "outgoing link count",
			"file.inlinks": "backlink count",
			"file.ctime": "created time",
			"file.mtime": "modified time"
		};
		return labelMap[key] || key;
	}
}
