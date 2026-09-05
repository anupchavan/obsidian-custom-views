/** Local calendar date, shared by note properties and file timestamps. */
export function localDateKey(value: unknown): string | null {
	let date: Date;
	if (typeof value === "number" && Number.isFinite(value)) {
		date = new Date(value);
	} else if (typeof value === "string") {
		const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
		if (!match) return null;
		const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
		const calendar = new Date(0);
		calendar.setFullYear(year, month - 1, day);
		if (calendar.getFullYear() !== year || calendar.getMonth() !== month - 1 || calendar.getDate() !== day) return null;
		if (value.length === 10) return value;
		date = new Date(value);
	} else return null;
	if (!Number.isFinite(date.getTime())) return null;
	return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
