interface PendingWrite<T> {
	value: T;
	waiters: { resolve(): void; reject(error: unknown): void }[];
}

/** Serialize disk writes and collapse queued edits into the latest complete settings snapshot. */
export class SettingsWriter<T> {
	private pending?: PendingWrite<T>;
	private writing = false;
	constructor(private write: (value: T) => Promise<void>) {}

	save(value: T): Promise<void> {
		const snapshot = structuredClone(value);
		return new Promise((resolve, reject) => {
			if (this.pending) {
				this.pending.value = snapshot;
				this.pending.waiters.push({ resolve, reject });
			} else {
				this.pending = { value: snapshot, waiters: [{ resolve, reject }] };
			}
			if (!this.writing) void this.drain();
		});
	}

	private async drain(): Promise<void> {
		this.writing = true;
		while (this.pending) {
			const job = this.pending;
			this.pending = undefined;
			try {
				await this.write(job.value);
				for (const waiter of job.waiters) waiter.resolve();
			} catch (error) {
				for (const waiter of job.waiters) waiter.reject(error);
			}
		}
		this.writing = false;
	}
}
