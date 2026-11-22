#!/usr/bin/env node
// Drives a real Obsidian (already running with --remote-debugging-port) against the test
// vault that run-obsidian.sh prepares, and checks the paths that internal API changes break.
// Usage: node scripts/obsidian-compat/e2e.mjs [cdp-url] [screenshot-dir]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const cdp = process.argv[2] ?? "http://127.0.0.1:9222";
const shots = process.argv[3] ?? "obsidian-e2e";
const PLUGIN = "custom-views";

async function connect() {
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			const browser = await chromium.connectOverCDP(cdp);
			for (let wait = 0; wait < 60; wait++) {
				for (const context of browser.contexts()) for (const page of context.pages()) {
					if (await page.evaluate(() => Boolean(globalThis.app?.workspace?.layoutReady)).catch(() => false)) return { browser, page };
				}
				await new Promise(r => setTimeout(r, 1000));
			}
			throw new Error("Obsidian started but no vault window finished loading.");
		} catch (error) {
			if (attempt === 59) throw error;
			await new Promise(r => setTimeout(r, 1000));
		}
	}
}

const { browser, page } = await connect();
const consoleErrors = [];
page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", error => consoleErrors.push(String(error)));

const results = [];
async function step(name, fn) {
	try {
		await fn();
		results.push({ name, ok: true });
		console.log(`ok    ${name}`);
	} catch (error) {
		results.push({ name, ok: false, error: String(error?.message ?? error) });
		console.log(`FAIL  ${name}: ${error?.message ?? error}`);
		mkdirSync(shots, { recursive: true });
		await page.screenshot({ path: `${shots}/${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
	}
}
const until = async (what, fn, timeout = 10000) => {
	const start = Date.now();
	for (;;) {
		const value = await fn();
		if (value) return value;
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}`);
		await page.waitForTimeout(200);
	}
};
const readData = () => page.evaluate(async id => {
	const dir = app.plugins.manifests[id].dir;
	return JSON.parse(await app.vault.adapter.read(`${dir}/data.json`));
}, PLUGIN);
const closeModals = () => page.evaluate(() => {
	document.querySelectorAll(".modal-container .modal-close-button").forEach(el => el.click());
	app.setting?.close?.();
});

console.log(`Obsidian ${await page.evaluate(() => globalThis.electron?.ipcRenderer?.sendSync?.("version") ?? navigator.userAgent)}`);

await step("Bases and Canvas core plugins enable", async () => {
	await page.evaluate(async () => {
		for (const id of ["bases", "canvas"]) {
			const plugin = app.internalPlugins.getPluginById(id);
			if (!plugin) throw new Error(`core plugin ${id} is missing`);
			if (!plugin.enabled) await plugin.enable(true);
		}
	});
});

await step("plugin loads", async () => {
	await page.evaluate(async id => {
		await app.plugins.setEnable(true);
		await app.plugins.loadManifests();
		if (!app.plugins.manifests[id]) throw new Error(`${id} is not installed in the test vault`);
		await app.plugins.enablePluginAndSave(id);
	}, PLUGIN);
	await until("the plugin instance", () => page.evaluate(id => Boolean(app.plugins.plugins[id]?._loaded), PLUGIN));
});

await step("view renders for a matching note", async () => {
	await page.evaluate(async () => {
		await app.workspace.getLeaf(true).openFile(app.vault.getAbstractFileByPath("Movies/Arrival.md"), { state: { mode: "preview" } });
	});
	await until("the rendered template", () => page.evaluate(() =>
		document.querySelector(".workspace-leaf.mod-active .cv-e2e-title")?.textContent?.includes("Arrival")), 15000);
});

await step("view does not render for a note outside its rules", async () => {
	await page.evaluate(async () => {
		await app.workspace.getLeaf(true).openFile(app.vault.getAbstractFileByPath("Other.md"), { state: { mode: "preview" } });
	});
	await page.waitForTimeout(1500);
	const rendered = await page.evaluate(() => Boolean(document.querySelector(".workspace-leaf.mod-active .cv-e2e-title")));
	if (rendered) throw new Error("the view rendered for Other.md");
});

// #37: the Rules editor in the view's settings modal must persist edits.
await step("Rules edits in settings save to data.json", async () => {
	const before = await readData();
	await page.evaluate(id => {
		app.setting.open();
		app.setting.openTabById(id);
		const tab = app.setting.activeTab;
		tab.openEditModal(app.plugins.plugins[id].settings.views[0]);
	}, PLUGIN);
	const select = ".modal-container .cv-native-filter-host .filter-group-header select";
	await until("the native Rules editor", () => page.evaluate(sel => Boolean(document.querySelector(sel)), select), 15000);
	const next = await page.evaluate(sel => {
		const el = document.querySelector(sel);
		const option = [...el.options].find(o => o.value !== el.value);
		el.value = option.value;
		el.dispatchEvent(new Event("change", { bubbles: true }));
		return option.value;
	}, select);
	await until("basesFilters in data.json", async () => {
		const data = await readData().catch(() => null);
		const filters = data?.views?.[0]?.basesFilters;
		return filters && typeof filters === "object" && next in filters;
	}, 5000);
	await closeModals();
	if (JSON.stringify(before) === JSON.stringify(await readData())) throw new Error("data.json did not change");
});

await step("view editor opens with its Rules control", async () => {
	await page.evaluate(id => {
		app.setting.open();
		app.setting.openTabById(id);
		const rows = document.querySelectorAll(".vertical-tab-content .setting-item [aria-label='View actions']");
		if (!rows.length) throw new Error("no view rows in settings");
		rows[0].click();
	}, PLUGIN);
	await until("the view actions menu", () => page.evaluate(() =>
		[...document.querySelectorAll(".menu .menu-item-title")].some(el => el.textContent === "Open view editor")));
	await page.evaluate(() => [...document.querySelectorAll(".menu .menu-item-title")].find(el => el.textContent === "Open view editor").click());
	await until("the view editor's Rules control", () => page.evaluate(() =>
		Boolean(document.querySelector(".workspace-leaf.mod-active .cv-editor-filter")?.textContent?.includes("Rules"))), 15000);
});

await step("no Custom Views errors in the console", async () => {
	const ours = consoleErrors.filter(text => /custom views|custom-views/i.test(text));
	if (ours.length) throw new Error(ours.slice(0, 5).join("\n"));
});

await browser.close().catch(() => {});
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} Obsidian checks passed.`);
process.exit(failed.length ? 1 : 0);
