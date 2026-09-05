interface RenderJob {
	key: string;
	controller: AbortController;
	promise: Promise<void>;
}

/** Only the latest request may finish a render; unrelated panes never wait. */
export class RenderCoordinator<Owner extends object> {
	private jobs = new Map<Owner, RenderJob>();
	run(owner: Owner, key: string, render: (signal: AbortSignal) => Promise<void>): Promise<void> {
		const previous = this.jobs.get(owner);
		if (previous?.key === key) return previous.promise;
		previous?.controller.abort();
		const controller = new AbortController();
		const job: RenderJob = { key, controller, promise: Promise.resolve() };
		job.promise = Promise.resolve().then(() => {
			controller.signal.throwIfAborted();
			return render(controller.signal);
		}).catch(error => {
			if (!controller.signal.aborted) throw error;
		}).finally(() => {
			if (this.jobs.get(owner) === job) this.jobs.delete(owner);
		});
		this.jobs.set(owner, job);
		return job.promise;
	}
	cancel(owner: Owner): void {
		this.jobs.get(owner)?.controller.abort();
		this.jobs.delete(owner);
	}
	cancelAll(): void {
		for (const job of this.jobs.values()) job.controller.abort();
		this.jobs.clear();
	}
}
