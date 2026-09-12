import { RetainedNoteHold } from "./retained-note-hold";
import { MarkdownView, WorkspaceLeaf, type App, type ViewStateResult } from "obsidian";

/** Hold the previous note until native loading and custom rendering finish. */
export class AtomicNavigation {
	enabled = true;
	private retained = new RetainedNoteHold();
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
		const held = (content: HTMLElement) => this.retained.has(content);
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

	private async navigate(content: HTMLElement, run: () => Promise<void>): Promise<void> {
		const release = this.retained.begin(content);
		try { await run(); }
		finally { release(); }
	}
	dispose(): void {
		this.enabled = false;
		this.retained.dispose();
		this.unpatch();
	}
}
