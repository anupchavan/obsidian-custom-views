import {
	BasesView,
	Component,
	MarkdownRenderer,
	Plugin,
	QueryController,
	TFile,
	parseYaml,
	stringifyYaml,
} from "obsidian";
import {
	createCollectorBaseDocuments,
	extractEmbeddedBaseBlocks,
	extractEmbeddedBaseFileLinks,
} from "./code-blocks";
import { extractTemplateBaseBlocks } from "./template-syntax";
import {
	CUSTOM_VIEWS_BASES_REQUEST_ID_KEY,
	CUSTOM_VIEWS_BASES_VIEW_TYPE,
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

interface PendingCollection {
	metadata: NormalizeBaseMetadata;
	resolve: (view: TemplateBaseView) => void;
	timeoutId: number;
}

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

export class EmbeddedBasesProvider implements BasesDataProvider {
	private pending = new Map<string, PendingCollection>();
	private nextRequestId = 0;
	private enabled = false;

	constructor(private plugin: Plugin) {}

	register(): boolean {
		this.enabled = this.plugin.registerBasesView(CUSTOM_VIEWS_BASES_VIEW_TYPE, {
			name: "Custom Views data",
			icon: "lucide-braces",
			factory: (controller: QueryController, containerEl: HTMLElement) =>
				new CustomViewsBasesCollectorView(controller, containerEl, this),
		});
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

	receiveResult(requestId: string, view: BasesView) {
		const pending = this.pending.get(requestId);
		if (!pending) return;

		window.clearTimeout(pending.timeoutId);
		this.pending.delete(requestId);
		pending.resolve(normalizeBasesView(view, pending.metadata));
	}

	private createRequestId(): string {
		this.nextRequestId++;
		return `cv-bases-${Date.now()}-${this.nextRequestId}`;
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

		const content = await request.app.vault.cachedRead(baseFile);
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
			() => this.createRequestId(),
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
			const markdown = toBaseCodeBlock(document.config);
			return this.renderCollectorBase(request, markdown, document.requestId, metadata);
		});
	}

	private async renderCollectorBase(
		request: EmbeddedBasesRequest,
		markdown: string,
		requestId: string,
		metadata: NormalizeBaseMetadata,
	): Promise<TemplateBaseView> {
		const result = this.waitForResult(requestId, metadata);
		const host = createVisibleHiddenHost(request.ownerDocument);
		const renderComponent = request.component.addChild(new Component());

		try {
			await MarkdownRenderer.render(request.app, markdown, host, request.file.path, renderComponent);
			return await result;
		} catch (error) {
			this.cancelPending(requestId);
			return createBaseErrorView(metadata, error instanceof Error ? error.message : String(error));
		} finally {
			request.component.removeChild(renderComponent);
			host.remove();
		}
	}

	private waitForResult(requestId: string, metadata: NormalizeBaseMetadata): Promise<TemplateBaseView> {
		return new Promise(resolve => {
			const timeoutId = window.setTimeout(() => {
				this.pending.delete(requestId);
				resolve(createBaseErrorView(metadata, "Timed out while collecting Bases data."));
			}, BASES_COLLECTION_TIMEOUT_MS);

			this.pending.set(requestId, {
				metadata,
				resolve,
				timeoutId,
			});
		});
	}

	private cancelPending(requestId: string) {
		const pending = this.pending.get(requestId);
		if (!pending) return;
		window.clearTimeout(pending.timeoutId);
		this.pending.delete(requestId);
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

class CustomViewsBasesCollectorView extends BasesView {
	type = CUSTOM_VIEWS_BASES_VIEW_TYPE;

	constructor(
		controller: QueryController,
		containerEl: HTMLElement,
		private provider: EmbeddedBasesProvider,
	) {
		super(controller);
		containerEl.empty();
		containerEl.addClass("cv-bases-collector-view");
	}

	onDataUpdated(): void {
		const requestId = getConfigString(this, CUSTOM_VIEWS_BASES_REQUEST_ID_KEY);
		if (!requestId) return;
		this.provider.receiveResult(requestId, this);
	}
}

function toBaseCodeBlock(config: Record<string, unknown>): string {
	return `\`\`\`base\n${stringifyYaml(config).trimEnd()}\n\`\`\``;
}

function createVisibleHiddenHost(ownerDocument: Document): HTMLElement {
	const host = ownerDocument.createElement("div");
	host.addClass("cv-bases-collector-host");
	ownerDocument.body.appendChild(host);
	return host;
}

function getConfigString(view: BasesView, key: string): string | null {
	const value = view.config.get(key);
	return typeof value === "string" ? value : null;
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
