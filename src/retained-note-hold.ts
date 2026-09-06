interface Hold { snapshot: HTMLElement; token: number; inert: boolean; observer?: MutationObserver }
interface Bounds { left: number; top: number; width: number; height: number }

/** Keep the old custom shell alive; copy only the editor that Obsidian is about to mutate. */
export class RetainedNoteHold {
	private holds = new Map<HTMLElement, Hold>();
	private nextId = 0;
	private bounds = new WeakMap<HTMLElement, Bounds>();
	private observed = new Set<HTMLElement>();
	private resize?: ResizeObserver;
	has(content: HTMLElement): boolean { return this.holds.has(content); }

	observe(content: HTMLElement): void {
		if (typeof ResizeObserver === "undefined") return;
		this.resize ??= new ResizeObserver(entries => {
			for (const entry of entries) {
				const target = entry.target as HTMLElement;
				if (target.isConnected && !this.holds.has(target)) this.bounds.set(target, this.measure(target));
			}
		});
		for (const target of this.observed) {
			if (!target.isConnected) { this.resize.unobserve(target); this.observed.delete(target); }
		}
		this.observed.add(content);
		// Reobserve after a render to capture changes between native and custom layout.
		this.resize.unobserve(content);
		this.resize.observe(content);
	}
	private measure(content: HTMLElement): Bounds {
		const overlay = content.querySelector<HTMLElement>(".obsidian-custom-view-render");
		const bounds = (overlay ?? content).getBoundingClientRect();
		const parent = content.parentElement?.getBoundingClientRect();
		return { left: bounds.left - (parent?.left ?? 0), top: bounds.top - (parent?.top ?? 0), width: bounds.width, height: bounds.height };
	}
	begin(content: HTMLElement): () => void {
		let entry = this.holds.get(content);
		if (!entry) {
			const overlay = content.querySelector<HTMLElement>(".obsidian-custom-view-render");
			const snapshot = content.cloneNode(!overlay) as HTMLElement;
			snapshot.classList.add("cv-navigation-snapshot");
			snapshot.setAttribute("aria-hidden", "true");
			snapshot.inert = true;
			// Editable overlays can cover the header because their containing block
			// is the leaf, not the static .view-content element. Preserve painted bounds.
			const bounds = this.bounds.get(content) ?? this.measure(content);
			const scrollTop = overlay?.scrollTop ?? content.scrollTop;
			Object.assign(snapshot.style, {
				left: `${bounds.left}px`, top: `${bounds.top}px`,
				width: `${bounds.width}px`, height: `${bounds.height}px`,
			});
			if (overlay) {
				(overlay as HTMLElement & { __cvScopeObserver?: MutationObserver }).__cvScopeObserver?.disconnect();
				const editor = overlay.querySelector<HTMLElement>(".markdown-source-view");
				if (editor) {
					const copy = editor.cloneNode(true) as HTMLElement;
					editor.replaceWith(copy);
					content.appendChild(editor);
					const scroll = editor.querySelector(".cm-scroller");
					const copiedScroll = copy.querySelector(".cm-scroller");
					if (scroll && copiedScroll) copiedScroll.scrollTop = scroll.scrollTop;
				}
				snapshot.appendChild(overlay);
			}
			// Each shell's stylesheet must stop targeting the other shell during preparation.
			const scope = content.getAttribute("data-cv-id");
			let observer: MutationObserver | undefined;
			if (scope) {
				const heldScope = `${scope}-held-${++this.nextId}`;
				snapshot.setAttribute("data-cv-id", heldScope);
				const scopeStyles = () => {
					for (const style of Array.from(snapshot.querySelectorAll("style"))) {
						const raw = style.textContent ?? "";
						let scoped = raw.split(`[data-cv-id="${scope}"]`).join(`[data-cv-id="${heldScope}"]`);
						if (scoped && !scoped.trim().startsWith(`[data-cv-id="${heldScope}"]`)) scoped = `[data-cv-id="${heldScope}"] {\n${scoped}\n}`;
						if (raw !== scoped) style.textContent = scoped;
					}
				};
				scopeStyles();
				// Old image/widget callbacks can still append styles during a slow navigation.
				observer = new MutationObserver(scopeStyles);
				observer.observe(snapshot, { subtree: true, childList: true, characterData: true });
			}
			snapshot.querySelectorAll("script").forEach(script => script.remove());
			content.after(snapshot);
			if (overlay) overlay.scrollTop = scrollTop;
			else snapshot.scrollTop = scrollTop;
			entry = { snapshot, token: 0, inert: content.inert, observer };
			this.holds.set(content, entry);
			content.classList.add("cv-navigation-preparing");
			content.inert = true;
		}
		entry.token++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			if (this.holds.get(content) === entry && --entry.token === 0) this.release(content);
		};
	}
	private release(content: HTMLElement): void {
		const entry = this.holds.get(content);
		if (!entry) return;
		entry.observer?.disconnect();
		entry.snapshot.remove();
		content.classList.remove("cv-navigation-preparing");
		content.inert = entry.inert;
		this.holds.delete(content);
		this.observe(content);
	}
	dispose(): void {
		for (const content of this.holds.keys()) this.release(content);
		this.resize?.disconnect(); this.resize = undefined; this.observed.clear();
	}
}
