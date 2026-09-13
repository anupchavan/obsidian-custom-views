// Obsidian supplies this global helper at runtime.
const delegatedListeners = new WeakMap<HTMLElement, { type: string; selector: string; listener: (this: HTMLElement, event: never, target: HTMLElement) => unknown; callback: EventListener }[]>();
HTMLElement.prototype.on = function(type, selector, listener, options) {
	const callback: EventListener = event => {
		const target = event.target as Element | null;
		const match = target?.closest(selector) as HTMLElement | null;
		if (match && this.contains(match)) listener.call(match, event as never, match);
	};
	const entries = delegatedListeners.get(this) ?? [];
	entries.push({ type, selector, listener, callback });
	delegatedListeners.set(this, entries);
	this.addEventListener(type, callback, options);
};
HTMLElement.prototype.off = function(type, selector, listener, options) {
	const entries = delegatedListeners.get(this) ?? [];
	for (const entry of entries) {
		if (entry.type === type && entry.selector === selector && entry.listener === listener) {
			this.removeEventListener(type, entry.callback, options);
		}
	}
	delegatedListeners.set(this, entries.filter(entry => entry.type !== type || entry.selector !== selector || entry.listener !== listener));
};

globalThis.createEl = (tag, options, callback) => {
	const element = window.document.createElement(tag);
	if (typeof options === "string") element.className = options;
	else if (options) {
		if (typeof options.text === "string") element.textContent = options.text;
		else if (options.text) element.appendChild(options.text);
		if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
		options.parent?.appendChild(element);
	}
	callback?.(element);
	return element;
};

globalThis.createFragment = callback => {
	const fragment = window.document.createDocumentFragment();
	fragment.appendText = text => { fragment.append(text); };
	fragment.createEl = (tag, options, callback) => {
		const element = createEl(tag, options, callback);
		fragment.append(element);
		return element;
	};
	callback?.(fragment);
	return fragment;
};

HTMLElement.prototype.createSpan = function(this: HTMLElement, options, callback) {
	const span = this.ownerDocument.adoptNode(createEl("span", options, callback));
	this.appendChild(span);
	return span;
};
