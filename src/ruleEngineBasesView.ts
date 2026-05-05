import ObsidianRuleEnginePlugin from "main";
import { BasesEntry, BasesView, HoverParent, HoverPopover, Keymap, parsePropertyId, QueryController } from "obsidian";

export const RULE_ENGINE_BASE_VIEW_ID = 'rule-engine-base';

export class RuleEngineBasesView extends BasesView implements HoverParent {
    type = RULE_ENGINE_BASE_VIEW_ID;
    private plugin: ObsidianRuleEnginePlugin;
    private containerEl: HTMLElement;
    public hoverPopover: HoverPopover | null = null;
    private isProcessing = false;

    constructor(controller: QueryController, scrollEl: HTMLElement, plugin: ObsidianRuleEnginePlugin) {
        super(controller);
        this.plugin = plugin;
        this.containerEl = scrollEl.createDiv({ cls: 'rule-bases-view-container' });
    }

    private lastDataHash: string = "";

    private get currentDataHash(): string {
        const dataHash = this.data.data.map(val => `${val.file.path}${val.file.stat.mtime}`).sort().join("_").toLowerCase();
        const propertyHash = this.data.properties.sort().join("_");
        const str = [dataHash, propertyHash].join("_");
        // FNV-1a hash
        let hash = 0x811c9dc5; // Offset basis
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193); // Prime multiplier
        }
        // Return as an unsigned hex string (e.g., "7f3a12b4")
        return (hash >>> 0).toString(16);
    }

    onload(): void {
        this.plugin.activeBasesView = this;
    }
    onunload(): void {
        this.plugin.activeBasesView = undefined;
    }

    public processView(ignoreDataHash = false): void {
        if (this.isProcessing) return;

        const layoutMode = this.config.get('layout') ?? 'table';
        this.plugin?.debug(`processView`, { ignoreDataHash, layoutMode });
        this.containerEl.empty();

        const order = this.config.getOrder();

        if (layoutMode === 'table') {
            const table = this.containerEl.createEl('table');
            table.setAttribute('style', `
            width: 100%;
            border-collapse: collapse;
            font-size: var(--font-small);
        `);
            const thead = table.createEl('thead');
            const headerRow = thead.createEl('tr');
            order.forEach(id => {
                const th = headerRow.createEl('th', { text: parsePropertyId(id).name });
                th.setAttribute('style', `
                text-align: left;
                padding: 4px 8px;
                border-bottom: 2px solid var(--background-modifier-border);
                color: var(--text-muted);
            `);
            });
            const tbody = table.createEl('tbody');
            for (let idx = 0; idx < this.data.groupedData.length; ++idx) {
                if (idx) {
                    tbody.append(headerRow.cloneNode(true));
                }
                const group = this.data.groupedData[idx];
                if (group?.entries?.length) {
                    this.renderGroupTableRows(tbody, group.entries, order);
                }
            }
        }

        if (layoutMode === 'grid') {
            for (const group of this.data.groupedData) {
                const groupWrapper = this.containerEl.createDiv();
                this.renderGrid(groupWrapper, group.entries, order);
            }
        }

        const viewEnabledCommands = Boolean(this.config.get('enableCommands'));
        const autoProcess = this.plugin.settings.processBaseResultsAutomatically;
        const canProcessCommands = viewEnabledCommands && (ignoreDataHash || autoProcess);
        this.plugin.debug(`canProcessCommands`, {
            canProcessCommands,
            viewEnabledCommands,
            ignoreDataHash,
            autoProcess
        });
        if (canProcessCommands) {
            const thisHash = this.currentDataHash;
            // Command execution only takes place automatically if the data has changed, not the order or grouping
            const willRunCommands = ignoreDataHash || this.lastDataHash !== thisHash;
            if (willRunCommands) {
                this.isProcessing = true;
                this.lastDataHash = thisHash;
                this.plugin.debug(`${willRunCommands ? 'data changed' : ignoreDataHash ? 'ignoring data hash' : ''}- processing commands...`)
                const groupLeaf = this.app.workspace.getLeaf("split", "vertical");
                try {
                    groupLeaf.setGroup("ore-leaf-group");
                    for (const group of this.data.groupedData) {
                        for (const entry of group.entries) {
                            const { commandIds } = this.plugin.extractMatchingRuleParameters(entry.file, { baseFileHandling: "results" });
                            // always use file mode on each entry since 'results' wouldn't make sense
                            this.plugin.executeCommands("file", commandIds, entry.file, groupLeaf);
                        }
                    }
                } catch (e) {
                    this.plugin.debug(e);
                } finally {
                    this.isProcessing = false;
                    groupLeaf.detach();
                }
            }
        }
    }

    public onDataUpdated(): void {
        this.processView(false);
    }

    public onOpen(): void {
        this.processView(true);
    }

    private renderGrid(parent: HTMLElement, entries: BasesEntry[], order: string[]) {
        const widthPc = String(this.config.get("widthPercentage")) + "%";
        const heightVal = this.config.get("heightPercentage");
        // If heightVal is 30, this makes the card at least 300px tall (adjust multiplier as needed)
        const minHeightPx = heightVal ? `${Number(heightVal) * 5}px` : "auto";
        const gapPx = Number(this.config.get('cardGap')) + 'px';
        const grid = parent.createDiv();
        // --- 2. Inlined Grid Engine ---
        grid.setAttribute('style', `
            display: grid;
            grid-template-columns: repeat(auto-fill,minmax(${widthPc},1fr));
            grid-template-rows: auto;
            gap: ${gapPx};
        `);

        for (const entry of entries) {
            const card = grid.createDiv();
            card.setAttribute('style', `
                min-height: ${minHeightPx};
                background-color: var(--background-secondary);
                border: 1px solid var(--background-modifier-border);
                border-radius: var(--radius-m);
            `);

            const { matchedTemplate } = this.plugin.extractMatchingRuleParameters(entry.file, { baseFileHandling: "results" });

            if (matchedTemplate?.length && Boolean(this.config.get('enableTemplates'))) {
                this.plugin.injectCustomView(card, entry.file, matchedTemplate).catch(e => console.error(e));
                continue;
            } else {
                // Render properties as rows inside the card
                for (const propId of order) {
                    // @ts-expect-error
                    const { type, name } = parsePropertyId(propId);
                    // @ts-expect-error
                    const value = entry.getValue(propId);
                    if (!value && name !== 'name') continue;

                    const cardRow = card.createDiv();
                    cardRow.classList.add(`ore-bases-grid-card`);

                    if (name === 'name' && type === 'file') {
                        cardRow.classList.add(`ore-bases-grid-card-file-name`);
                        this.renderFileLink(cardRow, entry);
                    } else {
                        cardRow.createSpan({ text: value?.toString() ?? '' });
                    }
                }
            }
        }
    }

    private renderGroupTableRows(tbody: HTMLElement, entries: BasesEntry[], order: string[]) {
        for (const entry of entries) {
            const tr = tbody.createEl('tr');
            order.forEach(id => {
                const td = tr.createEl('td', { cls: 'ore-base-group-cell' });
                //@ts-expect-error - ignore specific string format
                const { type, name } = parsePropertyId(id);
                //@ts-expect-error - ignore specific string format
                const value = entry.getValue(id);

                if (name === 'name' && type === 'file') {
                    this.renderFileLink(td, entry);
                } else {
                    if (value === null) {
                        td.setText('-');
                    } else {
                        td.setText(value?.toString() ?? "");
                    }
                }
            });
        }
    }

    private renderFileLink(container: HTMLElement, entry: BasesEntry) {
        const linkEl = container.createEl('a', { text: entry.file.name, cls: 'ore-bases-file-link' });

        linkEl.onClickEvent((evt) => {
            evt.preventDefault();
            const modEvent = Keymap.isModEvent(evt);
            void this.plugin.app.workspace.openLinkText(entry.file.path, '', modEvent);
        });

        linkEl.addEventListener('mouseover', (evt) => {
            this.plugin.app.workspace.trigger('hover-link', {
                event: evt, source: 'bases', hoverParent: this,
                targetEl: linkEl, linktext: entry.file.path,
            });
        });
    }
}