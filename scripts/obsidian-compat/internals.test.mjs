import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInternals, INTERNALS } from "./internals.mjs";
import { readAsarFile } from "./check-internals.mjs";

const allNames = INTERNALS.flatMap(entry => entry.anyOf.flat());
const source = names => names.map(name => `a.${name}(b);`).join("");
const result = (src, id) => checkInternals(src).find(r => r.id === id);

test("a source with every name passes every check", () => {
	assert.deepEqual(checkInternals(source(allNames)).filter(r => !r.ok), []);
});

test("#37: 1.15 dropped setGlobalFilters for setFilters; either shape passes, neither fails", () => {
	const without = allNames.filter(name => name !== "setGlobalFilters" && name !== "setFilters");
	assert.equal(result(source([...without, "setFilters"]), "bases-query-save-global-filters").ok, true);
	assert.equal(result(source([...without, "setGlobalFilters"]), "bases-query-save-global-filters").ok, true);
	const broken = result(source(without), "bases-query-save-global-filters");
	assert.equal(broken.ok, false);
	assert.deepEqual(broken.missing, [["setGlobalFilters"], ["setFilters"]]);
});

test("names match whole identifiers only", () => {
	assert.equal(result("x.setFiltersLater(); x.mysetFilters();", "bases-query-save-global-filters").ok, false);
	assert.equal(result("{setFilters(t,e,i){}}", "bases-query-save-global-filters").ok, true);
});

test("reads app.js out of an asar archive", () => {
	const content = Buffer.from("app.setFilters()");
	const header = Buffer.from(JSON.stringify({ files: { "app.js": { offset: "0", size: content.length } } }));
	const pad = (4 - (header.length % 4)) % 4;
	const pickle = Buffer.alloc(16 + header.length + pad);
	pickle.writeUInt32LE(4, 0);
	pickle.writeUInt32LE(8 + header.length + pad, 4);
	pickle.writeUInt32LE(4 + header.length + pad, 8);
	pickle.writeUInt32LE(header.length, 12);
	header.copy(pickle, 16);
	// The real format: an 8-byte size pickle, then the header pickle, then file data.
	const archive = Buffer.concat([pickle.subarray(0, 8), pickle.subarray(8), content]);
	assert.equal(readAsarFile(archive, "app.js"), "app.setFilters()");
});
