import ObsidianRuleEnginePlugin from "main";
import { CommandWithSetup } from "types";
import { forceTemplate } from "./forceTemplate";
import { MarkdownView, Notice } from "obsidian";
import { taskDate } from "./taskDate";

export type GetCommandFn<TConfig extends Record<string, unknown> = Record<string, unknown>> = (plugin: ObsidianRuleEnginePlugin) => CommandWithSetup<TConfig>;

const processNow: GetCommandFn = (plugin) => ({
    id: "check-rules",
    name: "Process now",
    description: "Check and execute automations as if the file has just been opened.",
    checkCallback: (checking: boolean) => {
        if (checking) {
            return plugin && plugin.settings.enabled;
        }
        try {
            const file = plugin?.app.workspace.getActiveFile();

            if (file) {
                void plugin?.processMarkdownView(file);
            }

            if (plugin?.activeBasesView) {
                plugin?.debug(`activeBasesView, processing results...`, plugin.activeBasesView);
                plugin?.activeBasesView?.processView(true);
            } else {
                plugin?.debug(`no activeBasesView, not processing results`);
            };

            return true;
        } catch (e) {
            plugin?.debug(e);
            return false;
        }
    },
});

const resetTemplate: GetCommandFn = (plugin) => ({
    id: "restore-view",
    name: "Restore view",
    description: "Reset the view to remove a template",
    checkCallback: (checking: boolean) => {
        if (checking) {
            return plugin && plugin.settings.enabled;
        }
        try {

            const file = plugin?.app.workspace.getActiveFile();

            if (file && plugin) {
                const leaf = plugin.app.workspace.getLeaf(false);
                if (leaf) {
                    if (!(leaf.view instanceof MarkdownView)) return;
                    plugin.restoreDefaultView(leaf.view);
                }
            }
            return true;
        } catch (e) {
            plugin?.debug(e);
            return false;
        }
    }
});

const deleteWithoutConfirmation: GetCommandFn = (plugin) => ({
    id: "delete-without-confirmation",
    name: "Delete current file without confirmation",
    description: "⚠️ Use this command cautiously!",
    callback: () => {
        const file = plugin?.app.workspace.getActiveFile();
        if (file) {
            plugin?.app.fileManager.trashFile(file).catch(e => {
                plugin?.debug(e);
            });
        }
    }
});

export const list: GetCommandFn[] = [processNow, forceTemplate, resetTemplate, taskDate, deleteWithoutConfirmation] as const;
