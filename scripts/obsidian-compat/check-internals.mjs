#!/usr/bin/env node
// Usage: node scripts/obsidian-compat/check-internals.mjs <obsidian-X.asar | obsidian-X.asar.gz | app.js>
// On a Mac with Catalyst, Obsidian keeps early-access builds in
// ~/Library/Application Support/obsidian/obsidian-<version>.asar.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { checkInternals } from "./internals.mjs";

/** Reads one file from an asar archive (Electron's format: a pickled JSON header, then file data). */
export function readAsarFile(archive, path) {
	const headerSize = archive.readUInt32LE(4);
	const jsonSize = archive.readUInt32LE(12);
	const header = JSON.parse(archive.toString("utf8", 16, 16 + jsonSize));
	let node = header;
	for (const part of path.split("/")) {
		node = node.files?.[part];
		if (!node) throw new Error(`${path} is not in this archive`);
	}
	const start = 8 + headerSize + Number(node.offset);
	return archive.toString("utf8", start, start + node.size);
}

export function loadAppSource(file) {
	let data = readFileSync(file);
	if (file.endsWith(".gz")) data = gunzipSync(data);
	return file.endsWith(".js") ? data.toString("utf8") : readAsarFile(data, "app.js");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const file = process.argv[2];
	if (!file) {
		console.error("Usage: check-internals.mjs <obsidian-X.asar | .asar.gz | app.js>");
		process.exit(2);
	}
	const results = checkInternals(loadAppSource(file));
	const failed = results.filter(r => !r.ok);
	for (const r of results) {
		if (r.ok) console.log(`ok    ${r.id}`);
		else console.log(`FAIL  ${r.id}: missing ${r.missing.map(m => m.join(", ")).join(" | or | ")} (used by ${r.usedBy})`);
	}
	console.log(`\n${results.length - failed.length} of ${results.length} internal API checks passed.`);
	process.exit(failed.length ? 1 : 0);
}
