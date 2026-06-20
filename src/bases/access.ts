export function buildBasesCollection(bases: readonly unknown[]): unknown[] {
	const collection = [...bases] as unknown[] & Record<string, unknown>;

	for (const base of bases) {
		if (!isRecord(base)) continue;

		addLookupValue(collection, getString(base.source, "name"), base);
		addLookupValue(collection, getString(base, "key"), base);
		addLookupValue(collection, getString(base, "name"), base);
	}

	return collection;
}

function addLookupValue(lookup: Record<string, unknown>, key: string | undefined, value: unknown) {
	if (!key || !isSafeLookupKey(key) || Object.prototype.hasOwnProperty.call(lookup, key)) return;
	lookup[key] = value;
}

function isSafeLookupKey(key: string): boolean {
	return key !== "__proto__" && key !== "prototype" && key !== "constructor";
}

function getString(record: unknown, key: string): string | undefined {
	if (!isRecord(record)) return undefined;
	const value = record[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
