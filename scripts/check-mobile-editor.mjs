/** Run against an open test vault: node scripts/check-mobile-editor.mjs VAULT_NAME.
 * Uses an in-memory view only; restores the view list, closes its leaf, and exits emulation.
 * Does not save templates, create notes, or inspect note contents.
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const vault = process.argv[2];
if (!vault) throw new Error("Provide the name of an open test vault.");
function command(...args) {
 return execFileSync("obsidian", [`vault=${vault}`, ...args], { encoding: "utf8", timeout: 20000 });
}
function evaluate(code) {
 const output = command("eval", `code=JSON.stringify(${code})`).trim();
 const result = output.replace(/^=>\s*/, "");
 return JSON.parse(result);
}
function cdp(method, params = {}) { command("dev:cdp", `method=${method}`, `params=${JSON.stringify(params)}`); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(code) {
 for (let attempt = 0; attempt < 80; attempt++) {
  try { const value = evaluate(code); if (value) return value; } catch { /* Renderer may be reloading. */ }
  await pause(100);
 }
 throw new Error(`Timed out waiting for the editor test: ${code}`);
}
const mobileBefore = evaluate("app.isMobile");
const key = "__cvMobileRegression";
try {
 cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
 command("dev:mobile", "on");
 await waitFor("!!app.plugins.plugins['custom-views']");
 evaluate(`(() => {
  const plugin = app.plugins.plugins['custom-views'];
  const fixture = window.${key} = { plugin, views: plugin.settings.views, ready: false };
  const config = { id: 'cv-mobile-regression', name: 'Mobile regression', enabled: true,
   rules: { type: 'group', operator: 'and', conditions: [] }, template: '<p>Mobile preview</p>', css: '', js: '' };
  plugin.settings.views = [...fixture.views, config];
  fixture.leaf = app.workspace.getLeaf('tab');
  fixture.leaf.setViewState({ type: 'custom-views-editor', active: true, state: { viewId: config.id } })
   .then(() => app.workspace.revealLeaf(fixture.leaf)).then(() => { fixture.ready = true; });
  return true;
 })()`);
 await waitFor(`window.${key}?.ready`);
 for (const [width, height] of [[320,568], [390,844], [390,390], [844,390], [768,1024]]) {
  cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
  await pause(250); // Allow ResizeObserver and native layout to settle.
  const result = evaluate(`(() => {
   const host = window.${key}.leaf.view.contentEl;
   const layout = host.querySelector('.cv-editor-layout');
   const context = host.querySelector('.cv-editor-contexts');
   const label = host.querySelector('[id="' + context.getAttribute('aria-labelledby') + '"]');
   const spacing = Math.max(0, parseFloat(getComputedStyle(host).paddingBottom));
   const probe = host.createDiv();
   probe.style.cssText = 'position:absolute;width:0;visibility:hidden;height:max(0px,var(--view-bottom-spacing,0px))';
   const nativeSpacing = probe.getBoundingClientRect().height; probe.remove();
   return { width: host.clientWidth, scroll: host.scrollWidth, dock: layout.dataset.dock,
    bottom: layout.getBoundingClientRect().bottom, hostBottom: host.getBoundingClientRect().bottom, spacing, nativeSpacing,
    tooltip: context.hasAttribute('aria-label'), label: label?.textContent,
    reorder: host.querySelectorAll('[aria-label^="Reorder "]').length,
    alerts: host.querySelectorAll('[role="alert"]').length,
    toolbarOverflow: [...host.querySelectorAll('.cv-editor-toolbar')].some(e => e.scrollWidth > e.clientWidth + 1) };
  })()`);
  assert.equal(result.tooltip, false);
  assert.equal(result.label, "Preview context");
  assert.equal(result.reorder, 3);
  assert.equal(result.alerts, 0);
  assert.equal(result.toolbarOverflow, false);
  assert.ok(result.scroll <= result.width + 1);
  assert.ok(Math.abs(result.spacing - result.nativeSpacing) <= 1);
  assert.ok(result.bottom <= result.hostBottom - result.spacing + 1);
  if (width < 600) assert.equal(result.dock, "bottom");
  console.log(`PASS ${width}x${height}: toolbar fit, context accessibility, touch controls, bottom clearance (${result.spacing}px)`);
 }
} finally {
 try {
  evaluate(`(() => {
   const fixture = window.${key};
   if (fixture) { fixture.plugin.settings.views = fixture.views; fixture.leaf?.detach(); delete window.${key}; }
   return true;
  })()`);
 } finally {
  cdp("Emulation.clearDeviceMetricsOverride");
  command("dev:mobile", mobileBefore ? "on" : "off");
 }
}
