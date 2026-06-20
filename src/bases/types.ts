import type { App, Component, TFile } from "obsidian";

export type TemplateBaseScalar = string | number | boolean | null;
export type TemplateBaseValue =
	| TemplateBaseScalar
	| TemplateBaseValue[]
	| { [key: string]: TemplateBaseValue };

export interface TemplateBaseFile {
	name: string;
	basename: string;
	path: string;
	folder: string;
	ext: string;
	link: string;
	properties: Record<string, TemplateBaseValue>;
	[key: string]: TemplateBaseValue | Record<string, TemplateBaseValue>;
}

export interface TemplateBaseColumn {
	id: string;
	key: string;
	name: string;
	type: "file" | "note" | "formula" | "unknown";
}

export interface TemplateBaseCell {
	id: string;
	key: string;
	name: string;
	type: "file" | "note" | "formula" | "unknown";
	value: TemplateBaseValue;
	text: string;
}

export interface TemplateBaseRow {
	file: TemplateBaseFile;
	values: Record<string, TemplateBaseValue>;
	text: Record<string, string>;
	cells: TemplateBaseCell[];
}

export interface TemplateBaseSource {
	kind: "template" | "code-block" | "file-embed";
	index: number;
	line: number;
	path?: string;
	name?: string;
}

export interface TemplateBaseView {
	key?: string;
	name: string;
	type: string;
	index: number;
	source: TemplateBaseSource;
	columns: TemplateBaseColumn[];
	rows: TemplateBaseRow[];
	rowCount: number;
	error?: string;
}

export type TemplateBases = TemplateBaseView[];

export interface EmbeddedBasesRequest {
	app: App;
	file: TFile;
	templateContent: string;
	sourceContent: string;
	ownerDocument: Document;
	component: Component;
}

export interface BasesDataProvider {
	getEmbeddedBases(request: EmbeddedBasesRequest): Promise<TemplateBases>;
}
