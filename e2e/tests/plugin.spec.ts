import { closeModal, expect, openEditRuleModal, openNote, openPluginSettings, test } from "../fixtures";

// ── 1. Plugin bootstrap ───────────────────────────────────────────────────────

test("plugin loads without errors", async ({ page }) => {
  const result = await page.evaluate(() => {
    const plugin = window.app.plugins.plugins["rule-engine"];
    const loadErrors = window.app.plugins.loadErrors ?? {};
    return {
      loaded: !!plugin,
      hasLoadError: "rule-engine" in loadErrors,
      loadError: loadErrors["rule-engine"] ?? null,
    };
  });
  expect(result.hasLoadError, result.loadError ?? "").toBe(false);
  expect(result.loaded).toBe(true);
});

test("plugin has correct version", async ({ page }) => {
  const version = await page.evaluate(
    () => window.app.plugins.manifests["rule-engine"]?.version
  );
  expect(version).toBeTruthy();
  expect(typeof version).toBe("string");
});

test("no rule-engine console errors on load", async ({ page }) => {
  // Collect errors emitted by the page (DOM errors, unhandled rejections)
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    if (err.message.toLowerCase().includes("rule")) errors.push(err.message);
  });
  // Re-evaluate after hooking — trigger a re-check cycle
  await page.evaluate(() =>
    (window.app.plugins.plugins["rule-engine"] as unknown as { loadSettings(): Promise<void> })
      ?.loadSettings?.()
  );
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

// ── 2. Settings UI ────────────────────────────────────────────────────────────

test("settings page shows Rule Engine tab and rule list", async ({ page }) => {
  await openPluginSettings(page, "Rule Engine");

  // Should show the "Add new rule" button
  const addBtn = page.locator("button", { hasText: "Add new rule" });
  await expect(addBtn).toBeVisible();

  // Should show at least 2 rules from our data.json
  const ruleItems = page.locator(".ore-rule-list-item");
  expect(await ruleItems.count()).toBeGreaterThan(1);

  await closeModal(page);
});

test("settings shows enabled toggle and it works", async ({ page }) => {
  await openPluginSettings(page, "Rule Engine");

  // The Enabled toggle lives in the Settings tab
  await page.locator(".modal-container .workspace-tab-header", { hasText: "Settings" }).click();

  const enabledToggle = page
    .locator(".modal-container .setting-item", { hasText: "Enabled" })
    .locator(".checkbox-container");
  await expect(enabledToggle).toBeVisible();

  await closeModal(page);
});

test("settings tabs switch between Rules, Settings, and Command configuration", async ({ page }) => {
  await openPluginSettings(page, "Rule Engine");

  // Rules tab is shown by default
  await expect(page.locator(".modal-container .workspace-tab-header", { hasText: "Rules" })).toHaveClass(/is-active/);
  await expect(page.locator("button", { hasText: "Add new rule" })).toBeVisible();

  // Switch to Settings tab
  await page.locator(".modal-container .workspace-tab-header", { hasText: "Settings" }).click();
  await expect(page.locator(".modal-container .workspace-tab-header", { hasText: "Settings" })).toHaveClass(/is-active/);
  await expect(page.locator("button", { hasText: "Add new rule" })).not.toBeVisible();
  await expect(page.locator(".modal-container .setting-item", { hasText: "Enabled" })).toBeVisible();

  // Switch to Command configuration tab
  await page.locator(".modal-container .workspace-tab-header", { hasText: "Command configuration" }).click();
  await expect(
    page.locator(".modal-container .workspace-tab-header", { hasText: "Command configuration" })
  ).toHaveClass(/is-active/);
  await expect(page.locator(".modal-container .setting-item", { hasText: "Enabled" })).not.toBeVisible();
  await expect(page.locator(".modal-container", { hasText: "Any command in Obsidian can be used in rules" })).toBeVisible();

  await closeModal(page);
});

// ── 3. Edit Rule Modal ────────────────────────────────────────────────────────

test("edit rule modal opens with correct sections", async ({ page }) => {
  await openPluginSettings(page, "Rule Engine");
  await openEditRuleModal(page, 0);

  const modal = page.locator(".ore-edit-rule-modal");
  await expect(modal).toBeVisible();

  // Rule name input
  await expect(modal.locator("input[type=text]").first()).toBeVisible();

  // Filters heading
  await expect(modal.locator(".setting-item-name", { hasText: "Filters" })).toBeVisible();

  // Commands heading
  await expect(modal.locator(".setting-item-name", { hasText: "Commands" })).toBeVisible();

  // HTML templates heading
  await expect(modal.locator(".setting-item-name", { hasText: "HTML templates" })).toBeVisible();

  await closeModal(page);
  await closeModal(page);
});

test("edit rule modal has editable template textareas", async ({ page }) => {
  await openPluginSettings(page, "Rule Engine");
  await openEditRuleModal(page, 0);

  const modal = page.locator(".ore-edit-rule-modal");

  // Three textareas: default, base file, canvas
  const textareas = modal.locator("textarea");
  expect(await textareas.count()).toBeGreaterThan(0);

  // Default template textarea should have our e2e template content
  const firstTextarea = textareas.first();
  await expect(firstTextarea).toBeVisible();
  const value = await firstTextarea.inputValue();
  expect(value).toContain("ore-e2e-rendered");

  // Should be editable
  await firstTextarea.fill('<div class="ore-e2e-updated">updated</div>');
  await expect(firstTextarea).toHaveValue('<div class="ore-e2e-updated">updated</div>');

  // Cancel to avoid persisting the change
  await page.locator(".ore-edit-rule-modal button", { hasText: "Cancel" }).click();
  await closeModal(page);
});

test("edit rule modal rule name is editable", async ({ page }) => {
  await openPluginSettings(page, "Rule Engine");
  await openEditRuleModal(page, 0);

  const nameInput = page.locator(".ore-edit-rule-modal input[type=text]").first();
  await nameInput.fill("Renamed Rule");
  await expect(nameInput).toHaveValue("Renamed Rule");

  // Cancel — don't save
  await page.locator(".ore-edit-rule-modal button", { hasText: "Cancel" }).click();
  await closeModal(page);
});

// ── 4. Filter Builder ─────────────────────────────────────────────────────────

test("filter builder shows existing filter condition", async ({ page }) => {
  await openPluginSettings(page, "Rule Engine");
  await openEditRuleModal(page, 0);

  // Rule 0 has a "file.name contains matched" filter
  const filterRow = page.locator(".filter-row");
  expect(await filterRow.count()).toBeGreaterThan(0);

  await closeModal(page);
  await closeModal(page);
});

test("filter builder — add a new filter", async ({ page }) => {
  await openPluginSettings(page, "Rule Engine");
  await openEditRuleModal(page, 0);

  const countBefore = await page.locator(".filter-row").count();

  // Click "Add filter" button
  const addFilterBtn = page.locator(".ore-text-icon-button", { hasText: "Add filter" }).first();
  await addFilterBtn.click();
  await page.waitForTimeout(300);

  // A new filter row should appear
  const countAfter = await page.locator(".filter-row").count();
  expect(countAfter).toBeGreaterThan(countBefore);

  await closeModal(page);
  await closeModal(page);
});

test("filter builder — delete a filter", async ({ page }) => {
  await openPluginSettings(page, "Rule Engine");
  // Use rule index 1 (tag rule) which has 1 filter, so deletion leaves 0 conditions (placeholder)
  await openEditRuleModal(page, 1);

  const modal = page.locator(".ore-edit-rule-modal");

  // Click add filter to ensure at least 1 explicit filter row
  const addBtn = modal.locator(".ore-text-icon-button", { hasText: "Add filter" }).first();
  await addBtn.click();
  await page.waitForTimeout(300);

  const rowsBefore = await modal.locator(".filter-row").count();

  // Click the first delete (trash) button in a filter row
  const deleteBtn = modal.locator(".filter-row .clickable-icon").first();
  await deleteBtn.click();
  await page.waitForTimeout(300);

  const rowsAfter = await modal.locator(".filter-row").count();
  expect(rowsAfter).toBeLessThan(rowsBefore);

  await closeModal(page);
  await closeModal(page);
});

// ── 5. Template Rendering ─────────────────────────────────────────────────────

test("matched file renders custom template in reading mode", async ({ page }) => {
  await openNote(page, "matched-file.md");

  // Switch to reading mode
  await page.evaluate(() => {
    const leaf = window.app.workspace.getLeaf(false);
    void (leaf as unknown as { setViewState(s: unknown): Promise<void> }).setViewState({
      type: "markdown",
      state: { file: "Notes/matched-file.md", mode: "preview" },
    });
  });
  await page.waitForTimeout(1500);

  // The plugin injects .obsidian-custom-rule-render when a rule matches
  const rendered = page.locator(".obsidian-custom-rule-render");
  await expect(rendered).toBeVisible({ timeout: 8000 });

  // Our template wraps content in .ore-e2e-rendered
  await expect(page.locator(".ore-e2e-rendered")).toBeVisible();
});

test("unmatched file does not render custom template", async ({ page }) => {
  await openNote(page, "other-file.md");

  // Wait until Obsidian has actually switched to the new file and the plugin has
  // had time to run restoreDefaultView (clearing the render div from the previous test)
  await page.waitForFunction(
    () => window.app?.workspace?.getActiveFile()?.name === "other-file.md",
    { timeout: 10000 }
  );
  await page.waitForTimeout(1000);

  // Obsidian keeps background leaf elements in the DOM — check it's not visible,
  // not that the element doesn't exist anywhere (the matched-file leaf may still be cached).
  await expect(page.locator(".obsidian-custom-rule-render").first()).not.toBeVisible();
});

test("tag-matched file renders tag rule template", async ({ page }) => {
  await openNote(page, "rich-frontmatter.md");

  await page.evaluate(() => {
    const leaf = window.app.workspace.getLeaf(false);
    void (leaf as unknown as { setViewState(s: unknown): Promise<void> }).setViewState({
      type: "markdown",
      state: { file: "Notes/rich-frontmatter.md", mode: "preview" },
    });
  });
  await page.waitForTimeout(1500);

  await expect(page.locator(".ore-e2e-tag-rendered")).toBeVisible({ timeout: 8000 });
});

test("file with a check_date in the past renders the within-past template", async ({ page }) => {
  await openNote(page, "within-past-check.md");

  await page.evaluate(() => {
    const leaf = window.app.workspace.getLeaf(false);
    void (leaf as unknown as { setViewState(s: unknown): Promise<void> }).setViewState({
      type: "markdown",
      state: { file: "Notes/within-past-check.md", mode: "preview" },
    });
  });
  await page.waitForTimeout(1500);

  await expect(page.locator(".ore-e2e-within-past-rendered")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".ore-e2e-within-future-rendered")).not.toBeVisible();
});

test("file with a check_date in the future renders the within-future template", async ({ page }) => {
  await openNote(page, "within-future-check.md");

  await page.evaluate(() => {
    const leaf = window.app.workspace.getLeaf(false);
    void (leaf as unknown as { setViewState(s: unknown): Promise<void> }).setViewState({
      type: "markdown",
      state: { file: "Notes/within-future-check.md", mode: "preview" },
    });
  });
  await page.waitForTimeout(1500);

  await expect(page.locator(".ore-e2e-within-future-rendered")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".ore-e2e-within-past-rendered")).not.toBeVisible();
});

test("file with 2 resolved outgoing links renders the outlinks-count template", async ({ page }) => {
  await openNote(page, "outlinks-check.md");

  await page.evaluate(() => {
    const leaf = window.app.workspace.getLeaf(false);
    void (leaf as unknown as { setViewState(s: unknown): Promise<void> }).setViewState({
      type: "markdown",
      state: { file: "Notes/outlinks-check.md", mode: "preview" },
    });
  });
  await page.waitForTimeout(1500);

  await expect(page.locator(".ore-e2e-outlinks-rendered")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".ore-e2e-inlinks-rendered")).not.toBeVisible();
});

test("file with 2 resolved incoming links renders the inlinks-count template", async ({ page }) => {
  await openNote(page, "inlinks-check.md");

  await page.evaluate(() => {
    const leaf = window.app.workspace.getLeaf(false);
    void (leaf as unknown as { setViewState(s: unknown): Promise<void> }).setViewState({
      type: "markdown",
      state: { file: "Notes/inlinks-check.md", mode: "preview" },
    });
  });
  await page.waitForTimeout(1500);

  await expect(page.locator(".ore-e2e-inlinks-rendered")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".ore-e2e-outlinks-rendered")).not.toBeVisible();
});

// ── 6. Plugin settings persistence ───────────────────────────────────────────

test("adding and saving a new rule persists it", async ({ page }) => {
  await openPluginSettings(page, "Rule Engine");

  const countBefore = await page.locator(".ore-rule-list-item").count();

  // Click "Add new rule"
  await page.locator("button", { hasText: "Add new rule" }).click();
  await page.waitForSelector(".ore-edit-rule-modal", { timeout: 5000 });

  // Set a unique name and save
  const nameInput = page.locator(".ore-edit-rule-modal input[type=text]").first();
  await nameInput.fill("Persisted Test Rule");
  await page.locator(".ore-edit-rule-modal button", { hasText: "Save" }).click();
  await page.waitForTimeout(500);

  const countAfter = await page.locator(".ore-rule-list-item").count();
  expect(countAfter).toBe(countBefore + 1);

  // Verify plugin settings reflect the new rule
  const ruleNames = await page.evaluate(() => {
    const plugin = window.app.plugins.plugins["rule-engine"] as unknown as {
      settings: { rules: Array<{ name: string }> };
    };
    return plugin?.settings?.rules?.map((r) => r.name) ?? [];
  });
  expect(ruleNames).toContain("Persisted Test Rule");

  await closeModal(page);
});
