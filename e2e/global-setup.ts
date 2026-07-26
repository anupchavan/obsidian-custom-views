import { chromium } from "@playwright/test";
import { execSync, spawn } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";

const REPO_ROOT = path.join(__dirname, "..");
const VAULT_DIR = path.join(REPO_ROOT, "e2e", "vault");
const PLUGIN_DIR = path.join(VAULT_DIR, ".obsidian", "plugins", "rule-engine");
const PID_FILE = path.join(__dirname, ".obsidian.pid");
const BACKUP_FILE = path.join(__dirname, ".obsidian-json.bak");

export const OBSIDIAN_BIN =
  process.env.OBSIDIAN_BIN ??
  (process.platform === "win32"
    ? "C:\\Program Files\\Obsidian\\Obsidian.exe"
    : process.platform === "darwin"
    ? "/Applications/Obsidian.app/Contents/MacOS/Obsidian"
    : "/opt/obsidian/obsidian"); // set OBSIDIAN_BIN in CI

export const CDP_PORT = parseInt(process.env.CDP_PORT ?? "9223", 10);

/** Path to the global Obsidian config file that lists known vaults. */
function obsidianConfigPath(): string {
  if (process.platform === "win32")
    return path.join(process.env.APPDATA ?? os.homedir(), "obsidian", "obsidian.json");
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
  return path.join(os.homedir(), ".config", "obsidian", "obsidian.json");
}

function waitForCDP(port: number, retries = 40, intervalMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://localhost:${port}/json/version`, (res) => {
        if (res.statusCode === 200) return resolve();
        attempt();
      });
      req.on("error", attempt);
      req.end();
    };
    const attempt = () => {
      if (++attempts >= retries) return reject(new Error(`CDP not available on port ${port} after ${retries}s`));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

function getObsidianPage(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/json`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const targets = JSON.parse(data) as Array<{ type: string; url: string; id: string }>;
          const page = targets.find((t) => t.type === "page" && t.url.includes("obsidian.md"));
          if (!page) return reject(new Error("Obsidian page not found in CDP targets"));
          resolve(`http://localhost:${port}`);
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    }).on("error", reject);
  });
}

function restoreObsidianConfig(configPath: string): void {
  if (existsSync(BACKUP_FILE)) {
    writeFileSync(configPath, readFileSync(BACKUP_FILE, "utf8"));
  }
}

export default async function globalSetup() {
  // 1. Build plugin
  console.log("[e2e] Building plugin...");
  execSync("npm run build", { cwd: REPO_ROOT, stdio: "inherit" });

  // 2. Copy built artifacts to vault plugin dir
  mkdirSync(PLUGIN_DIR, { recursive: true });
  copyFileSync(path.join(REPO_ROOT, "main.js"), path.join(PLUGIN_DIR, "main.js"));
  copyFileSync(path.join(REPO_ROOT, "styles.css"), path.join(PLUGIN_DIR, "styles.css"));
  copyFileSync(path.join(REPO_ROOT, "manifest.json"), path.join(PLUGIN_DIR, "manifest.json"));

  // Write plugin data.json with test rules (gitignored, so must be generated)
  writeFileSync(
    path.join(PLUGIN_DIR, "data.json"),
    JSON.stringify(
      {
        enabled: true,
        workInLivePreview: true,
        workInCanvas: false,
        processBaseResultsAutomatically: false,
        processOnSave: false,
        useDnd: true,
        debug: false,
        rules: [
          {
            id: "e2e-rule-name",
            name: "Name Match Rule",
            filterGroup: {
              type: "group",
              operator: "AND",
              conditions: [{ type: "filter", field: "file.name", operator: "contains", value: "matched" }],
            },
            template: '<div class="ore-e2e-rendered"><h1>{{file.basename}}</h1><p>{{description}}</p></div>',
            enabled: true,
            commandIds: [],
            baseFileHandling: "file",
          },
          {
            id: "e2e-rule-tag",
            name: "Tag Rule",
            filterGroup: {
              type: "group",
              operator: "AND",
              conditions: [{ type: "filter", field: "file", operator: "has tag", value: "rich" }],
            },
            template: '<div class="ore-e2e-tag-rendered"><p>tagged: {{tags}}</p></div>',
            enabled: true,
            commandIds: [],
            baseFileHandling: "file",
          },
          {
            id: "e2e-rule-folder",
            name: "Folder Rule",
            filterGroup: {
              type: "group",
              operator: "AND",
              conditions: [{ type: "filter", field: "file", operator: "in folder", value: "Notes" }],
            },
            template: "",
            enabled: false,
            commandIds: [],
            baseFileHandling: "file",
          },
          {
            id: "e2e-rule-within-past",
            name: "Within Past Rule",
            filterGroup: {
              type: "group",
              operator: "AND",
              conditions: [{ type: "filter", field: "check_date", operator: "within past", value: "7 days" }],
            },
            template: '<div class="ore-e2e-within-past-rendered"><p>check_date within past 7 days</p></div>',
            enabled: true,
            commandIds: [],
            baseFileHandling: "file",
          },
          {
            id: "e2e-rule-within-future",
            name: "Within Future Rule",
            filterGroup: {
              type: "group",
              operator: "AND",
              conditions: [{ type: "filter", field: "check_date", operator: "within future", value: "7 days" }],
            },
            template: '<div class="ore-e2e-within-future-rendered"><p>check_date within future 7 days</p></div>',
            enabled: true,
            commandIds: [],
            baseFileHandling: "file",
          },
          {
            id: "e2e-rule-outlinks",
            name: "Outlinks Count Rule",
            filterGroup: {
              type: "group",
              operator: "AND",
              conditions: [{ type: "filter", field: "file.outlinks", operator: "=", value: "2" }],
            },
            template: '<div class="ore-e2e-outlinks-rendered"><p>outlinks = 2</p></div>',
            enabled: true,
            commandIds: [],
            baseFileHandling: "file",
          },
          {
            id: "e2e-rule-inlinks",
            name: "Inlinks Count Rule",
            filterGroup: {
              type: "group",
              operator: "AND",
              conditions: [{ type: "filter", field: "file.inlinks", operator: "=", value: "2" }],
            },
            template: '<div class="ore-e2e-inlinks-rendered"><p>inlinks = 2</p></div>',
            enabled: true,
            commandIds: [],
            baseFileHandling: "file",
          },
        ],
        commands: {},
      },
      null,
      2
    )
  );

  // Notes with a relative `check_date` for the "within past"/"within future" filter rules
  // (gitignored, so must be generated — a checked-in fixed date would go stale relative to "now").
  // 3/5-day buffers, matching src/__tests__/matcher.test.ts, so local-midnight vs UTC-ms
  // timezone differences (max ~26h) cannot flip the result.
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const fiveDaysFromNow = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  writeFileSync(
    path.join(VAULT_DIR, "Notes", "within-past-check.md"),
    [
      "---",
      `description: "check_date is a few days in the past"`,
      `check_date: ${threeDaysAgo}`,
      "---",
      "",
      "# Within Past Check",
      "",
      "This note's check_date frontmatter property is a few days in the past.",
      "",
    ].join("\n")
  );
  writeFileSync(
    path.join(VAULT_DIR, "Notes", "within-future-check.md"),
    [
      "---",
      `description: "check_date is a few days in the future"`,
      `check_date: ${fiveDaysFromNow}`,
      "---",
      "",
      "# Within Future Check",
      "",
      "This note's check_date frontmatter property is a few days in the future.",
      "",
    ].join("\n")
  );

  // 3. Register e2e vault in Obsidian's global config
  const configPath = obsidianConfigPath();
  mkdirSync(path.dirname(configPath), { recursive: true });

  let original: string | null = null;
  if (existsSync(configPath)) {
    original = readFileSync(configPath, "utf8");
    writeFileSync(BACKUP_FILE, original);
  }

  const vaultId = "e2etestv001";
  const config = original ? (JSON.parse(original) as Record<string, unknown>) : {};
  const vaults = (config.vaults ?? {}) as Record<string, unknown>;
  // Mark all existing vaults as not-open so Obsidian opens ours
  for (const v of Object.values(vaults) as Array<Record<string, unknown>>) {
    v.open = false;
  }
  vaults[vaultId] = { path: VAULT_DIR, ts: Date.now(), open: true };
  config.vaults = vaults;
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  // 4. Kill ALL existing Obsidian processes — Electron's single-instance lock would
  //    forward our --remote-debugging-port to the already-running instance (which has
  //    no debug port) and exit, so the CDP server would never start.
  console.log("[e2e] Killing any existing Obsidian instances...");
  if (process.platform === "win32") {
    try { execSync("taskkill /f /im Obsidian.exe", { stdio: "ignore", shell: "cmd.exe" }); } catch { /* not running */ }
  } else {
    try { execSync("pkill -f obsidian", { stdio: "ignore" }); } catch { /* not running */ }
  }
  // Give the OS a moment to release the single-instance lock file
  await new Promise((r) => setTimeout(r, 1500));

  // 5. Launch Obsidian
  console.log(`[e2e] Launching Obsidian with CDP port ${CDP_PORT}...`);
  const args = [`--remote-debugging-port=${CDP_PORT}`];
  if (process.platform === "linux") args.push("--no-sandbox", "--disable-gpu");

  const child = spawn(OBSIDIAN_BIN, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":99" },
  });
  child.unref();
  if (child.pid) writeFileSync(PID_FILE, String(child.pid));

  // 6. Wait for CDP, dismiss the vault-trust dialog, and verify the plugin loaded
  try {
    console.log("[e2e] Waiting for Obsidian to start...");
    await waitForCDP(CDP_PORT);
    await getObsidianPage(CDP_PORT);

    // Connect via Playwright CDP to interact with the Obsidian UI
    const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
    const context = browser.contexts()[0];
    let obsidianPage = context.pages().find((p) => p.url().includes("obsidian.md"));
    if (!obsidianPage) {
      obsidianPage = await context.waitForEvent("page", {
        predicate: (p) => p.url().includes("obsidian.md"),
        timeout: 15000,
      });
    }

    // Obsidian shows "Do you trust the author of this vault?" for new vaults.
    // Click "Trust author and enable plugins" so community plugins actually load.
    const trustBtn = obsidianPage.locator("button", { hasText: "Trust author and enable plugins" });
    if (await trustBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      console.log("[e2e] Dismissing vault trust dialog...");
      await trustBtn.click();
    }

    // Wait for the rule-engine plugin to finish loading
    console.log("[e2e] Waiting for plugin to load...");
    await obsidianPage.waitForFunction(
      () => !!window.app?.plugins?.plugins?.["rule-engine"],
      { timeout: 20000 }
    );

    await browser.close();
    console.log("[e2e] Obsidian ready.");
  } catch (err) {
    restoreObsidianConfig(configPath);
    throw err;
  }
}
