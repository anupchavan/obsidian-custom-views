// Obsidian supplies this global helper at runtime.
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
	callback?.(fragment);
	return fragment;
};
