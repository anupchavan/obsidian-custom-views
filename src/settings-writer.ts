interface PendingWrite<T> {
	value: T;
	write(value: T): Promise<void>;
	waiters: { resolve(): void; reject(error: unknown): void }[];
}

/** Serialize disk writes and collapse queued edits into the latest complete settings snapshot. */
export class SettingsWriter<T> {
	private pending?: PendingWrite<T>;
	private writing = false;
	private idleWaiters: (() => void)[] = [];
	constructor(private write: (value: T) => Promise<void>) {}

	save(value: T, write = this.write): Promise<void> {
		const snapshot = structuredClone(value);
		return new Promise((resolve, reject) => {
			if (this.pending) {
				this.pending.value = snapshot;
				this.pending.write = write;
				this.pending.waiters.push({ resolve, reject });
			} else {
				this.pending = { value: snapshot, write, waiters: [{ resolve, reject }] };
			}
			if (!this.writing) void this.drain();
		});
	}

	whenIdle(): Promise<void> {
		if (!this.writing) return Promise.resolve();
		return new Promise(resolve => this.idleWaiters.push(resolve));
	}

	private async drain(): Promise<void> {
		this.writing = true;
		while (this.pending) {
			const job = this.pending;
			this.pending = undefined;
			try {
				await job.write(job.value);
				for (const waiter of job.waiters) waiter.resolve();
			} catch (error) {
				for (const waiter of job.waiters) waiter.reject(error);
			}
		}
		this.writing = false;
		for (const resolve of this.idleWaiters.splice(0)) resolve();
	}
}


// Stored on the app rather than in module state so plugin hot reloads keep the queue.
const sharedWriterKey = Symbol.for("custom-views.settings-writer.v1");

export function getSharedSettingsWriter<T>(app: object, write: (value: T) => Promise<void>): {
	save(value: T): Promise<void>;
	whenIdle(): Promise<void>;
} {
	const host = app as { [sharedWriterKey]?: SettingsWriter<unknown> };
	const writer = host[sharedWriterKey] ??= new SettingsWriter<unknown>(async () => {
		throw new Error("A settings write requires a persistence callback.");
	});
	return {
		save: value => writer.save(value, snapshot => write(snapshot as T)),
		whenIdle: () => writer.whenIdle(),
	};
}
