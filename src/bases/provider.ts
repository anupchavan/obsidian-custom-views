import {
	TFile,
	parseYaml,
	stringifyYaml,
	type App,
	type BasesView,
	type Plugin,
	type Vault,
} from "obsidian";
import {
	createCollectorBaseDocuments,
	extractEmbeddedBaseBlocks,
	extractEmbeddedBaseFileLinks,
} from "./code-blocks";
import { extractTemplateBaseBlocks } from "./template-syntax";
import {
	type BasesDataProvider,
	type EmbeddedBasesRequest,
	type TemplateBaseView,
	type TemplateBases,
} from "./types";
import {
	createBaseErrorView,
	normalizeBasesView,
	type NormalizeBaseMetadata,
} from "./normalize";

const BASES_COLLECTION_TIMEOUT_MS = 5000;
const BASES_COLLECTION_POLL_MS = 25;

type BaseSource =
	| {
		kind: "template";
		name?: string;
		content: string;
		start: number;
		line: number;
	}
	| {
		kind: "code-block";
		content: string;
		start: number;
		line: number;
	}
	| {
		kind: "file-embed";
		target: string;
		viewName?: string;
		start: number;
		line: number;
	};

type RenderJobSource = {
	sourceKind: NormalizeBaseMetadata["sourceKind"];
	sourceIndex: number;
	sourceLine: number;
	sourcePath?: string;
	sourceName?: string;
	viewName?: string;
};

interface BaseEmbedFactoryContext {
	app: App;
	containerEl: HTMLElement;
	sourcePath: string;
	linktext: string;
}

type BaseEmbedFactory = (
	context: BaseEmbedFactoryContext,
	file: TFile,
	viewName?: string,
) => InternalBaseEmbed;

interface InternalBaseEmbed {
	containerEl?: HTMLElement;
	containingFile?: TFile;
	controller?: InternalBaseController;
	loadFile?: () => Promise<void> | void;
	unload?: () => void;
}

interface InternalBaseController {
	currentFile?: TFile;
	view?: BasesView | null;
	error?: unknown;
	errorEl?: HTMLElement;
	queue?: {
		queue?: {
			runnable?: {
				running?: boolean;
			};
		};
	};
}

interface FakeBaseFileEntry {
	file: TFile;
	content: string;
}

interface FakeVaultPatch {
	files: Map<string, FakeBaseFileEntry>;
	read: Vault["read"];
	cachedRead: Vault["cachedRead"];
	modify: Vault["modify"];
	create: Vault["create"];
}

const fakeVaultPatches = new WeakMap<Vault, FakeVaultPatch>();
let nextFakeBaseFileId = 0;

export class EmbeddedBasesProvider implements BasesDataProvider {
	private enabled = false;

	constructor(private plugin: Plugin) {}

	register(): boolean {
		this.enabled = !!getBaseEmbedFactory(this.plugin.app);
		return this.enabled;
	}

	async getEmbeddedBases(request: EmbeddedBasesRequest): Promise<TemplateBases> {
		if (!this.enabled) return [];

		const sources = await this.getStableBaseSources(request);
		if (sources.length === 0) return [];

		const renderJobs: Promise<TemplateBaseView>[] = [];
		for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
			const source = sources[sourceIndex];
			const jobs = source.kind === "template"
				? this.createRenderJobsForTemplateBase(request, source, sourceIndex)
				: source.kind === "code-block"
					? this.createRenderJobsForConfig(request, source.content, {
						sourceKind: "code-block",
						sourceIndex,
						sourceLine: source.line,
						viewName: undefined,
					})
					: await this.createRenderJobsForBaseFile(request, source, sourceIndex);
			renderJobs.push(...jobs);
		}

		return Promise.all(renderJobs);
	}

	private async getStableBaseSources(request: EmbeddedBasesRequest): Promise<BaseSource[]> {
		const templateSources = getTemplateBaseSources(request.templateContent);
		let noteSources: BaseSource[];
		try {
			const sourceContent = await request.app.vault.cachedRead(request.file);
			noteSources = getOrderedBaseSources(sourceContent);
		} catch {
			noteSources = getOrderedBaseSources(request.sourceContent);
		}
		return [...templateSources, ...noteSources];
	}

	private createRenderJobsForTemplateBase(
		request: EmbeddedBasesRequest,
		source: Extract<BaseSource, { kind: "template" }>,
		sourceIndex: number,
	): Promise<TemplateBaseView>[] {
		if (!source.content.trim()) {
			return [Promise.resolve(createBaseErrorView({
				sourceKind: "template",
				sourceIndex,
				sourceLine: source.line,
				sourceName: source.name,
				viewIndex: 0,
				viewName: "",
				originalType: "",
			}, "Template base block is empty."))];
		}

		return this.createRenderJobsForConfig(request, source.content, {
			sourceKind: "template",
			sourceIndex,
			sourceLine: source.line,
			sourceName: source.name,
			viewName: undefined,
		});
	}

	private async createRenderJobsForBaseFile(
		request: EmbeddedBasesRequest,
		source: Extract<BaseSource, { kind: "file-embed" }>,
		sourceIndex: number,
	): Promise<Promise<TemplateBaseView>[]> {
		const baseFile = resolveEmbeddedBaseFile(request, source.target);
		if (!baseFile) {
			return [Promise.resolve(createBaseErrorView({
				sourceKind: "file-embed",
				sourceIndex,
				sourceLine: source.line,
				sourcePath: source.target,
				viewIndex: 0,
				viewName: source.viewName ?? "",
				originalType: "",
			}, `Could not resolve embedded base file: ${source.target}`))];
		}

		let content: string;
		try {
			content = await request.app.vault.cachedRead(baseFile);
		} catch (error) {
			return [Promise.resolve(createBaseErrorView({
				sourceKind: "file-embed",
				sourceIndex,
				sourceLine: source.line,
				sourcePath: baseFile.path,
				viewIndex: 0,
				viewName: source.viewName ?? "",
				originalType: "",
			}, error instanceof Error ? error.message : String(error)))];
		}

		return this.createRenderJobsForConfig(request, content, {
			sourceKind: "file-embed",
			sourceIndex,
			sourceLine: source.line,
			sourcePath: baseFile.path,
			viewName: source.viewName,
		});
	}

	private createRenderJobsForConfig(
		request: EmbeddedBasesRequest,
		sourceContent: string,
		source: RenderJobSource,
	): Promise<TemplateBaseView>[] {
		let config: unknown;
		try {
			config = parseYaml(sourceContent);
		} catch (error) {
			return [Promise.resolve(createBaseErrorView({
				sourceKind: source.sourceKind,
				sourceIndex: source.sourceIndex,
				sourceLine: source.sourceLine,
				sourcePath: source.sourcePath,
				sourceName: source.sourceName,
				viewIndex: 0,
				viewName: source.viewName ?? "",
				originalType: "",
			}, error instanceof Error ? error.message : String(error)))];
		}

		const documents = createCollectorBaseDocuments(
			config,
			source.sourceIndex,
			source.viewName,
		);

		if (documents.length === 0) {
			return [Promise.resolve(createBaseErrorView({
				sourceKind: source.sourceKind,
				sourceIndex: source.sourceIndex,
				sourceLine: source.sourceLine,
				sourcePath: source.sourcePath,
				sourceName: source.sourceName,
				viewIndex: 0,
				viewName: source.viewName ?? "",
				originalType: "",
			}, source.viewName
				? `Could not find Bases view: ${source.viewName}`
				: "Could not find a Bases view to collect."))];
		}

		return documents.map(document => {
			const metadata: NormalizeBaseMetadata = {
				sourceKind: source.sourceKind,
				sourceIndex: document.sourceIndex,
				sourceLine: source.sourceLine,
				sourcePath: source.sourcePath,
				sourceName: source.sourceName,
				viewIndex: document.viewIndex,
				viewName: document.viewName,
				originalType: document.originalType,
			};
			const baseContent = toBaseFileContent(document.config);
			return this.renderCollectorBase(request, baseContent, metadata);
		});
	}

	private async renderCollectorBase(
		request: EmbeddedBasesRequest,
		baseContent: string,
		metadata: NormalizeBaseMetadata,
	): Promise<TemplateBaseView> {
		const baseEmbedFactory = getBaseEmbedFactory(request.app);
		if (!baseEmbedFactory) {
			return createBaseErrorView(metadata, "Obsidian Bases embed API is unavailable.");
		}

		const host = createVisibleHiddenHost(request.ownerDocument);
		const fakeFile = createFakeBaseFile(request.app);
		const uninstallFakeFile = installFakeBaseFile(request.app.vault, fakeFile, baseContent);
		let embed: InternalBaseEmbed | null = null;

		try {
			embed = baseEmbedFactory({
				app: request.app,
				containerEl: host,
				sourcePath: request.file.path,
				linktext: "",
			}, fakeFile, toBaseViewSubpath(metadata.viewName));

			if (!embed || typeof embed.loadFile !== "function") {
				throw new Error("Obsidian Bases embed API did not return a loadable embed.");
			}

			embed.containingFile = request.file;
			if (embed.controller) {
				embed.controller.currentFile = request.file;
			}

			await embed.loadFile();
			await waitForBaseEmbedData(embed, BASES_COLLECTION_TIMEOUT_MS);

			const view = embed.controller?.view;
			if (!isBasesViewLike(view)) {
				throw new Error(getBaseControllerError(embed) ?? "Could not collect Bases view data.");
			}

			return normalizeBasesView(view, metadata);
		} catch (error) {
			return createBaseErrorView(metadata, error instanceof Error ? error.message : String(error));
		} finally {
			try {
				embed?.unload?.();
			} catch {
				// Best-effort cleanup for an internal component.
			}
			uninstallFakeFile();
			host.remove();
		}
	}
}

function resolveEmbeddedBaseFile(request: EmbeddedBasesRequest, target: string): TFile | null {
	const linkedFile = request.app.metadataCache.getFirstLinkpathDest(target, request.file.path);
	if (isBaseFile(linkedFile)) return linkedFile;

	const directFile = request.app.vault.getFileByPath(target);
	if (isBaseFile(directFile)) return directFile;

	if (!target.includes("/")) {
		const parentPath = request.file.parent?.path ?? "";
		const relativePath = parentPath ? `${parentPath}/${target}` : target;
		const relativeFile = request.app.vault.getFileByPath(relativePath);
		if (isBaseFile(relativeFile)) return relativeFile;
	}

	return null;
}

function isBaseFile(file: unknown): file is TFile {
	return file instanceof TFile && file.extension === "base";
}

function toBaseFileContent(config: Record<string, unknown>): string {
	return stringifyYaml(config).trimEnd();
}

function createVisibleHiddenHost(ownerDocument: Document): HTMLElement {
	const host = ownerDocument.createElement("div");
	host.classList.add("cv-bases-collector-host");
	ownerDocument.body.appendChild(host);
	return host;
}

function getTemplateBaseSources(template: string): BaseSource[] {
	return extractTemplateBaseBlocks(template).map(block => ({
		kind: "template",
		name: block.name,
		content: block.content,
		start: block.start,
		line: block.line,
	}));
}

function getOrderedBaseSources(markdown: string): BaseSource[] {
	const codeBlocks: BaseSource[] = extractEmbeddedBaseBlocks(markdown).map(block => ({
		kind: "code-block",
		content: block.content,
		start: block.start,
		line: block.line,
	}));
	const fileEmbeds: BaseSource[] = extractEmbeddedBaseFileLinks(markdown).map(link => ({
		kind: "file-embed",
		target: link.target,
		viewName: link.viewName,
		start: link.start,
		line: link.line,
	}));

	return [...codeBlocks, ...fileEmbeds].sort((a, b) => a.start - b.start);
}

function getBaseEmbedFactory(app: App): BaseEmbedFactory | null {
	const embedRegistry = (app as App & {
		embedRegistry?: {
			embedByExtension?: Record<string, unknown>;
		};
	}).embedRegistry;
	const factory = embedRegistry?.embedByExtension?.base;
	return typeof factory === "function" ? factory as BaseEmbedFactory : null;
}

function toBaseViewSubpath(viewName: string): string {
	return viewName ? `#${viewName}` : "";
}

function createFakeBaseFile(app: App): TFile {
	nextFakeBaseFileId++;
	const basename = `.custom-views-bases-query-${Date.now()}-${nextFakeBaseFileId}`;
	const path = `${basename}.base`;

	return {
		basename,
		cache: () => undefined,
		deleted: false,
		extension: "base",
		getNewPathAfterRename: () => path,
		getShortName: () => basename,
		name: `${basename}.base`,
		parent: null,
		path,
		saving: false,
		setPath: () => undefined,
		stat: {
			ctime: -1,
			mtime: -1,
			size: 0,
		},
		updateCacheLimit: () => undefined,
		vault: app.vault,
		// eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
	} as unknown as TFile;
}

function installFakeBaseFile(vault: Vault, file: TFile, content: string): () => void {
	let patch = fakeVaultPatches.get(vault);
	if (!patch) {
		const originalRead = vault.read.bind(vault) as Vault["read"];
		const originalCachedRead = vault.cachedRead.bind(vault) as Vault["cachedRead"];
		const originalModify = vault.modify.bind(vault) as Vault["modify"];
		const originalCreate = vault.create.bind(vault) as Vault["create"];

		patch = {
			files: new Map(),
			read: originalRead,
			cachedRead: originalCachedRead,
			modify: originalModify,
			create: originalCreate,
		};
		fakeVaultPatches.set(vault, patch);
		const installedPatch = patch;

		vault.read = function patchedRead(target: TFile) {
			const fake = installedPatch.files.get(target.path);
			return fake ? Promise.resolve(fake.content) : installedPatch.read(target);
		};
		vault.cachedRead = function patchedCachedRead(target: TFile) {
			const fake = installedPatch.files.get(target.path);
			return fake ? Promise.resolve(fake.content) : installedPatch.cachedRead(target);
		};
		vault.modify = function patchedModify(target: TFile, data: string, options?: Parameters<Vault["modify"]>[2]) {
			const fake = installedPatch.files.get(target.path);
			return fake ? Promise.resolve() : installedPatch.modify(target, data, options);
		};
		vault.create = function patchedCreate(path: string, data: string, options?: Parameters<Vault["create"]>[2]) {
			const fake = Array.from(installedPatch.files.values()).find(entry => entry.file.path === path);
			return fake ? Promise.resolve(fake.file) : installedPatch.create(path, data, options);
		};
	}

	patch.files.set(file.path, { file, content });

	return () => {
		const currentPatch = fakeVaultPatches.get(vault);
		if (!currentPatch) return;
		currentPatch.files.delete(file.path);
		if (currentPatch.files.size > 0) return;

		vault.read = currentPatch.read;
		vault.cachedRead = currentPatch.cachedRead;
		vault.modify = currentPatch.modify;
		vault.create = currentPatch.create;
		fakeVaultPatches.delete(vault);
	};
}

function waitForBaseEmbedData(embed: InternalBaseEmbed, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		let pollId: number | undefined;
		const timeoutId = window.setTimeout(() => {
			if (pollId !== undefined) window.clearTimeout(pollId);
			reject(new Error("Timed out while collecting Bases data."));
		}, timeoutMs);

		const poll = () => {
			const controllerError = getBaseControllerError(embed);
			if (controllerError) {
				window.clearTimeout(timeoutId);
				reject(new Error(controllerError));
				return;
			}
			if (isBaseEmbedDataReady(embed)) {
				window.clearTimeout(timeoutId);
				resolve();
				return;
			}
			pollId = window.setTimeout(poll, BASES_COLLECTION_POLL_MS);
		};

		poll();
	});
}

function isBaseEmbedDataReady(embed: InternalBaseEmbed): boolean {
	const view = embed.controller?.view;
	return isBasesViewLike(view);
}

function getBaseControllerError(embed: InternalBaseEmbed): string | null {
	const controller = embed.controller;
	if (!controller?.error) return null;

	const message = controller.errorEl?.textContent?.trim();
	if (message) return message;
	if (controller.error instanceof Error) return controller.error.message;
	if (typeof controller.error === "string") return controller.error;
	return "Obsidian reported a Bases collection error.";
}

function isBasesViewLike(value: unknown): value is BasesView {
	return isRecord(value) &&
		isRecord(value.config) &&
		typeof value.config.getDisplayName === "function" &&
		isRecord(value.data) &&
		Array.isArray(value.data.properties) &&
		Array.isArray(value.data.data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
