import {
	BasesView,
	type BasesPropertyId,
	ListValue,
	NullValue,
	TFile,
	Value,
	parsePropertyId,
} from "obsidian";
import type {
	TemplateBaseCell,
	TemplateBaseColumn,
	TemplateBaseFile,
	TemplateBaseRow,
	TemplateBaseValue,
	TemplateBaseView,
} from "./types";

export interface NormalizeBaseMetadata {
	sourceKind: "template" | "code-block" | "file-embed";
	sourceIndex: number;
	sourceLine: number;
	sourcePath?: string;
	sourceName?: string;
	viewIndex: number;
	viewName: string;
	originalType: string;
}

export function normalizeBasesView(
	view: BasesView,
	metadata: NormalizeBaseMetadata,
): TemplateBaseView {
	const properties = view.data?.properties ?? [];
	const columns = properties.map(propertyId => normalizeColumn(view, propertyId));
	const rows = (view.data?.data ?? []).map(entry => {
		const row: TemplateBaseRow = {
			file: normalizeFile(entry.file, getFileFrontmatter(view, entry.file)),
			values: {},
			text: {},
			cells: [],
		};

		for (const column of columns) {
			const value = entry.getValue(column.id as BasesPropertyId);
			const normalizedValue = normalizeValue(value);
			const text = valueToText(value);
			const cell: TemplateBaseCell = {
				...column,
				value: normalizedValue,
				text,
			};

			row.cells.push(cell);
			assignCellValue(row.values, column.id, normalizedValue);
			assignCellValue(row.values, column.key, normalizedValue);
			assignCellText(row.text, column.id, text);
			assignCellText(row.text, column.key, text);
		}

		return row;
	});

	return {
		key: metadata.sourceName ?? metadata.viewName,
		name: metadata.viewName,
		type: metadata.originalType,
		index: metadata.viewIndex,
		source: {
			kind: metadata.sourceKind,
				index: metadata.sourceIndex,
				line: metadata.sourceLine,
				path: metadata.sourcePath,
				name: metadata.sourceName,
			},
			columns,
			rows,
		rowCount: rows.length,
	};
}

export function createBaseErrorView(
	metadata: NormalizeBaseMetadata,
	error: string,
): TemplateBaseView {
	return {
		key: metadata.sourceName ?? metadata.viewName,
		name: metadata.viewName,
		type: metadata.originalType,
		index: metadata.viewIndex,
		source: {
			kind: metadata.sourceKind,
				index: metadata.sourceIndex,
				line: metadata.sourceLine,
				path: metadata.sourcePath,
				name: metadata.sourceName,
			},
		columns: [],
		rows: [],
		rowCount: 0,
		error,
	};
}

function normalizeColumn(view: BasesView, propertyId: string): TemplateBaseColumn {
	const parsed = safeParsePropertyId(propertyId);
	return {
		id: propertyId,
		key: parsed.name,
		name: safeDisplayName(view, propertyId, parsed.name),
		type: parsed.type,
	};
}

function safeParsePropertyId(propertyId: string): TemplateBaseColumn {
	try {
		const parsed = parsePropertyId(propertyId as BasesPropertyId);
		return {
			id: propertyId,
			key: parsed.name,
			name: parsed.name,
			type: parsed.type,
		};
	} catch {
		return {
			id: propertyId,
			key: propertyId,
			name: propertyId,
			type: "unknown",
		};
	}
}

function safeDisplayName(view: BasesView, propertyId: string, fallback: string): string {
	try {
		return view.config.getDisplayName(propertyId as BasesPropertyId);
	} catch {
		return fallback;
	}
}

function normalizeFile(
	file: TFile,
	frontmatter: Record<string, unknown> | undefined,
): TemplateBaseFile {
	const folder = file.path.includes("/") ? file.path.substring(0, file.path.lastIndexOf("/")) : "";
	const properties = normalizeFrontmatter(frontmatter);
	const normalizedFile: TemplateBaseFile = {
		name: file.name,
		basename: file.basename,
		path: file.path,
		folder,
		ext: file.extension,
		link: `[[${file.path.replace(/\.md$/i, "")}|${file.basename}]]`,
		properties,
	};

	for (const [key, value] of Object.entries(properties)) {
		if (!(key in normalizedFile)) {
			normalizedFile[key] = value;
		}
	}

	return normalizedFile;
}

function normalizeValue(value: Value | null): TemplateBaseValue {
	if (!value || value === NullValue.value) return null;
	if (value instanceof ListValue) {
		const items: TemplateBaseValue[] = [];
		for (let i = 0; i < value.length(); i++) {
			items.push(normalizeValue(value.get(i)));
		}
		return items;
	}
	return value.toString();
}

function valueToText(value: Value | null): string {
	if (!value || value === NullValue.value) return "";
	return value.toString();
}

function normalizeFrontmatter(frontmatter: Record<string, unknown> | undefined): Record<string, TemplateBaseValue> {
	const properties: Record<string, TemplateBaseValue> = {};
	for (const [key, value] of Object.entries(frontmatter ?? {})) {
		if (key !== "position") {
			properties[key] = normalizePlainValue(value);
		}
	}
	return properties;
}

function normalizePlainValue(value: unknown): TemplateBaseValue {
	if (value === null || value === undefined) return null;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(normalizePlainValue);
	}
	if (typeof value === "object") {
		const normalized: Record<string, TemplateBaseValue> = {};
		for (const [key, child] of Object.entries(value)) {
			normalized[key] = normalizePlainValue(child);
		}
		return normalized;
	}
	return null;
}

function getFileFrontmatter(
	view: BasesView,
	file: TFile,
): Record<string, unknown> | undefined {
	const app = (view as BasesView & { app?: BasesView["app"] }).app;
	return app?.metadataCache.getFileCache(file)?.frontmatter;
}

function assignCellValue(
	target: Record<string, TemplateBaseValue>,
	key: string,
	value: TemplateBaseValue,
) {
	if (!(key in target)) {
		target[key] = value;
	}
}

function assignCellText(target: Record<string, string>, key: string, value: string) {
	if (!(key in target)) {
		target[key] = value;
	}
}
