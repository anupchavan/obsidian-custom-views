import { chromium, test as base, type Browser, type Page } from "@playwright/test";
import { CDP_PORT } from "./global-setup";

declare global {
  interface Window {
    app: {
      workspace: {
        containerEl: HTMLElement;
        getActiveFile(): { path: string; name: string; basename: string } | null;
        openLinkText(linkText: string, sourcePath: string): Promise<void>;
        getLeaf(newLeaf?: boolean): { view: { getViewType(): string } };
      };
      vault: { getMarkdownFiles(): Array<{ path: string; name: string; basename: string }> };
      plugins: {
        plugins: Record<string, { settings: Record<string, unknown> } | undefined>;
        manifests: Record<string, { version: string }>;
        loadErrors: Record<string, string>;
      };
    };
  }
}

type WorkerFixtures = { obsidianBrowser: Browser };
type TestFixtures = { page: Page };

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Shared per-worker browser connection to Obsidian
  obsidianBrowser: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the literal destructuring pattern here
    async ({}, use) => {
      const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
      await use(browser);
      // close() disconnects CDP without killing Obsidian
      await browser.close();
    },
    { scope: "worker" },
  ],

  // Per-test page — resolves to the live Obsidian window
  page: async ({ obsidianBrowser }, use) => {
    const context = obsidianBrowser.contexts()[0];
    let page = context.pages().find((p) => p.url().includes("obsidian.md"));
    if (!page) {
      page = await context.waitForEvent("page", {
        predicate: (p) => p.url().includes("obsidian.md"),
        timeout: 15000,
      });
    }
    // Wait for Obsidian workspace to be fully ready
    await page.waitForFunction(() => !!window.app?.workspace?.containerEl, { timeout: 30000 });
    await use(page);
  },
});

export { expect } from "@playwright/test";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Open a note by its filename (e.g. "matched-file.md") via Obsidian's API. */
export async function openNote(page: Page, filename: string): Promise<void> {
  await page.evaluate(async (name) => {
    const file = window.app.vault.getMarkdownFiles().find((f) => f.name === name);
    if (!file) throw new Error(`File not found in vault: ${name}`);
    await window.app.workspace.openLinkText(file.path, "");
  }, filename);
  // Allow the view to render
  await page.waitForTimeout(800);
}

/** Open Obsidian Settings then navigate to a named plugin/tab. */
export async function openPluginSettings(page: Page, tabLabel: string): Promise<void> {
  // Use command palette to open settings reliably
  await page.evaluate(() => {
    (window.app as unknown as { setting: { open(): void } }).setting?.open();
  });
  await page.waitForSelector(".modal-container", { timeout: 10000 });

  // Click the tab in the vertical nav
  await page.evaluate((label) => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".vertical-tab-nav-item"));
    const tab = items.find((el) => el.textContent?.trim() === label);
    if (!tab) throw new Error(`Settings tab not found: ${label}`);
    tab.click();
  }, tabLabel);

  await page.waitForTimeout(400);

  // Rule Engine's settings page has its own internal tab bar whose active tab
  // is stored on the long-lived PluginSettingTab instance (not reset when the
  // modal closes), so a prior test switching tabs would otherwise leak into
  // whichever test runs next. Always reset to the default "Rules" tab here.
  const rulesTab = page.locator(".modal-container .workspace-tab-header", { hasText: "Rules" });
  if (await rulesTab.isVisible({ timeout: 1000 }).catch(() => false)) {
    await rulesTab.click();
    await page.waitForTimeout(200);
  }
}

/** Close any open modal by pressing Escape. */
export async function closeModal(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

/** Click the edit (pencil) icon on the nth rule in the Rule Engine settings list. */
export async function openEditRuleModal(page: Page, ruleIndex = 0): Promise<void> {
  await page.evaluate((idx) => {
    const actions = document.querySelectorAll<HTMLElement>(".ore-rule-actions");
    const actionEl = actions[idx];
    if (!actionEl) throw new Error(`Rule at index ${idx} not found`);
    // First clickable-icon in the actions is the edit button
    const editBtn = actionEl.querySelector<HTMLElement>("button, .clickable-icon");
    if (!editBtn) throw new Error("Edit button not found in rule actions");
    editBtn.click();
  }, ruleIndex);
  await page.waitForSelector(".ore-edit-rule-modal", { timeout: 5000 });
}
