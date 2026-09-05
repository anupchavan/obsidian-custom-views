import { RetainedNoteHold } from "./retained-note-hold";
import { MarkdownView, WorkspaceLeaf, type App, type ViewStateResult } from "obsidian";

interface Transition {
	finished: Promise<void>;
	ready: Promise<void>;
	skipTransition(): void;
}
type TransitionDocument = Document & { startViewTransition?(update: () => Promise<void>): Transition };
interface Job { run(): Promise<void>; resolve(): void; reject(error: unknown): void }
interface Batch {
	owner: TransitionDocument;
	jobs: Job[];
	finishedJobs: { job: Job; error?: unknown; failed: boolean }[];
	phase: "capture" | "update" | "finish";
	transition?: Transition;
	targets: Map<HTMLElement, { name: string; priority: string }>;
}

/** Experimental hook: hold the previous note until native loading and custom rendering finish. */
export class AtomicNavigation {
	enabled = true;
	strategy: "retained" | "compositor" = "retained";
	private retained = new RetainedNoteHold();
	private batches = new Map<Document, Batch>();
	private unpatch: () => void;
	private loads = new WeakMap<MarkdownView, Promise<void>>();
	private leafLoads = new WeakMap<WorkspaceLeaf, Promise<void>>();
	private managedLeaves = new WeakMap<WorkspaceLeaf, number>();
	observe(content: HTMLElement): void { this.retained.observe(content); }
	private serialize(view: MarkdownView, update: () => Promise<void>): Promise<void> {
		const previous = this.loads.get(view);
		const pending = previous ? previous.catch(() => {}).then(update) : update();
		this.loads.set(view, pending);
		void pending.finally(() => { if (this.loads.get(view) === pending) this.loads.delete(view); }).catch(() => {});
		return pending;
	}
	private serializeLeaf(leaf: WorkspaceLeaf, update: () => Promise<void>): Promise<void> {
		const previous = this.leafLoads.get(leaf);
		const pending = previous ? previous.catch(() => {}).then(update) : update();
		this.leafLoads.set(leaf, pending);
		void pending.finally(() => { if (this.leafLoads.get(leaf) === pending) this.leafLoads.delete(leaf); }).catch(() => {});
		return pending;
	}

	constructor(
		app: App,
		shouldHold: (view: MarkdownView, state: Record<string, unknown>) => boolean,
		render: (view: MarkdownView) => Promise<void>,
	) {
		const prototype = MarkdownView.prototype;
		// eslint-disable-next-line @typescript-eslint/unbound-method -- Invoke with the original receiver below.
		const original = prototype.setState;
		const enabled = () => this.enabled;
		const navigate = (content: HTMLElement, update: () => Promise<void>) => this.navigate(content, update);
		const serialize = (view: MarkdownView, update: () => Promise<void>) => this.serialize(view, update);
		const held = (content: HTMLElement) => this.retained.has(content) || this.batches.has(content.ownerDocument);
		const managed = (leaf: WorkspaceLeaf) => (this.managedLeaves.get(leaf) ?? 0) > 0;
		const patched: typeof original = async function (this: MarkdownView, state: Record<string, unknown>, result: ViewStateResult) {
			const update = async () => {
				await original.call(this, state, result);
				if (enabled()) await render(this);
			};
			if (!enabled() || this.app !== app) {
				await original.call(this, state, result);
				return;
			}
			if (managed(this.leaf)) { await serialize(this, update); return; }
			if (!held(this.contentEl) && !shouldHold(this, state)) {
				await serialize(this, async () => { await original.call(this, state, result); });
				return;
			}
			await navigate(this.contentEl, () => serialize(this, update));
		};
		prototype.setState = patched;
		// Obsidian's setViewState silently returns while leaf.working is true.
		// Queue at this earlier boundary so rapid clicks are not dropped.
		// eslint-disable-next-line @typescript-eslint/unbound-method -- Invoke with the original leaf receiver.
		const originalLeaf = WorkspaceLeaf.prototype.setViewState;
		const serializeLeaf = (leaf: WorkspaceLeaf, update: () => Promise<void>) => this.serializeLeaf(leaf, update);
		const manage = (leaf: WorkspaceLeaf, delta: number) => this.managedLeaves.set(leaf, (this.managedLeaves.get(leaf) ?? 0) + delta);
		const patchedLeaf: typeof originalLeaf = async function (this: WorkspaceLeaf, ...args: Parameters<typeof originalLeaf>) {
			if (!enabled() || (this as WorkspaceLeaf & { app?: App }).app !== app) { await originalLeaf.apply(this, args); return; }
			const update = () => serializeLeaf(this, async () => { await originalLeaf.apply(this, args); });
			const view = this.view;
			const state = args[0].state ?? {};
			if (!(view instanceof MarkdownView) || (!held(view.contentEl) && !shouldHold(view, state))) {
				await update(); return;
			}
			manage(this, 1);
			try { await navigate(view.contentEl, update); }
			finally { manage(this, -1); }
		};
		WorkspaceLeaf.prototype.setViewState = patchedLeaf;
		this.unpatch = () => {
			if (prototype.setState === patched) prototype.setState = original;
			if (WorkspaceLeaf.prototype.setViewState === patchedLeaf) WorkspaceLeaf.prototype.setViewState = originalLeaf;
		};
	}

	private navigate(content: HTMLElement, run: () => Promise<void>): Promise<void> {
		if (this.strategy === "retained") {
			const release = this.retained.begin(content);
			return run().finally(release);
		}
		const document = content.ownerDocument as TransitionDocument;
		if (!document.startViewTransition) return run();
		let batch = this.batches.get(document);
		if (batch?.phase === "finish") {
			batch.transition?.skipTransition();
			this.cleanup(batch);
			batch = undefined;
		}
		let resolve!: () => void; let reject!: (error: unknown) => void;
		const result = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
		const job = { run, resolve, reject };
		if (batch) {
			batch.jobs.push(job);
			return result;
		}
		const name = "cv-note";
		batch = { owner: document, jobs: [job], finishedJobs: [], phase: "capture", targets: new Map() };
		batch.targets.set(content, {
			name: content.style.getPropertyValue("view-transition-name"),
			priority: content.style.getPropertyPriority("view-transition-name"),
		});
		content.style.setProperty("view-transition-name", name);
		document.documentElement.setAttribute("data-cv-navigation-held", "true");
		this.batches.set(document, batch);
		const active = batch;
		const update = async () => {
			active.phase = "update";
			while (active.jobs.length) {
				const jobs = active.jobs.splice(0);
				await Promise.all(jobs.map(async next => {
					try { await next.run(); active.finishedJobs.push({ job: next, failed: false }); }
					catch (error) { active.finishedJobs.push({ job: next, failed: true, error }); }
				}));
			}
			active.phase = "finish";
		};
		try {
			active.transition = document.startViewTransition(update);
			// Capture can be skipped (e.g. hidden windows), but update still runs.
			void active.transition.ready.catch(() => {});
			void active.transition.finished.catch(() => {}).then(() => this.complete(active));
		} catch {
			void update().finally(() => this.complete(active));
		}
		return result;
	}

	private cleanup(batch: Batch): void {
		for (const [content, previous] of batch.targets) {
			if (previous.name) content.style.setProperty("view-transition-name", previous.name, previous.priority);
			else content.style.removeProperty("view-transition-name");
		}
		batch.targets.clear();
		if (this.batches.get(batch.owner) === batch) {
			this.batches.delete(batch.owner);
			batch.owner.documentElement.removeAttribute("data-cv-navigation-held");
		}
	}
	private complete(batch: Batch): void {
		this.cleanup(batch);
		for (const { job, failed, error } of batch.finishedJobs) {
			if (failed) job.reject(error); else job.resolve();
		}
		batch.finishedJobs.length = 0;
	}
	dispose(): void {
		this.enabled = false;
		this.retained.dispose();
		this.unpatch();
		for (const batch of this.batches.values()) {
			batch.transition?.skipTransition();
			this.cleanup(batch);
		}
	}
}
