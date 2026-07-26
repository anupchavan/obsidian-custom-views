import { execSync } from "child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";

const PID_FILE = path.join(__dirname, ".obsidian.pid");
const BACKUP_FILE = path.join(__dirname, ".obsidian-json.bak");

function obsidianConfigPath(): string {
  if (process.platform === "win32")
    return path.join(process.env.APPDATA ?? os.homedir(), "obsidian", "obsidian.json");
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
  return path.join(os.homedir(), ".config", "obsidian", "obsidian.json");
}

export default async function globalTeardown() {
  // Kill Obsidian
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /f /pid ${pid}`, { stdio: "ignore" });
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch { /* already dead */ }
    unlinkSync(PID_FILE);
  }

  // Restore original obsidian.json
  const configPath = obsidianConfigPath();
  if (existsSync(BACKUP_FILE)) {
    writeFileSync(configPath, readFileSync(BACKUP_FILE, "utf8"));
    unlinkSync(BACKUP_FILE);
  }
}
