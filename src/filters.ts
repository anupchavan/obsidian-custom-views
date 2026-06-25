import { moment } from "obsidian";

/** Split a string into lowercase words for kebab/snake/pascal casing */
const WORD_SPLIT_RE = /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g;
function splitWords(str: string): string[] | null {
	return str.match(WORD_SPLIT_RE)?.map(w => w.toLowerCase()) ?? null;
}

function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripHtmlTags(str: string): string {
	let result = '';
	let inTag = false;
	let quote: string | null = null;

	for (let i = 0; i < str.length; i++) {
		const char = str[i];

		if (inTag) {
			if (quote) {
				if (char === quote) quote = null;
				continue;
			}
			if (char === '"' || char === "'") {
				quote = char;
				continue;
			}
			if (char === '>') {
				inTag = false;
			}
			continue;
		}

		if (char === '<' && str.indexOf('>', i + 1) !== -1) {
			inTag = true;
			quote = null;
			continue;
		}

		result += char;
	}

	return result;
}

const HTML_ENTITY_MAP: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#039;': "'",
	'&#x27;': "'",
	'&#x2F;': '/',
};

function unescapeHtmlEntitiesOnce(str: string): string {
	return str.replace(/&(amp|lt|gt|quot|#039|#x27|#x2F);/g, entity => HTML_ENTITY_MAP[entity] ?? entity);
}

function normalizeHtmlName(name: string): string | null {
	const trimmed = name.trim();
	return /^[A-Za-z][A-Za-z0-9:-]*$/.test(trimmed) ? trimmed : null;
}

function formatMarkdownDestination(src: string): string {
	const needsAngleBrackets = /[\s()<>]/.test(src);
	return needsAngleBrackets
		? `<${src.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\n/g, "%0A")}>`
		: src;
}

function formatMarkdownImage(src: string, alt: string): string {
	return `![${alt}](${formatMarkdownDestination(src)})`;
}

function formatMarkdownLink(destination: string, label: string): string {
	return `[${label}](${formatMarkdownDestination(destination)})`;
}

/**
 * Parse arguments like: "YYYY-MM-DD" or ("a", "b")
 * @param argString - The string to parse
 * @returns The parsed arguments
 */
function parseArgs(argString: string): (string | number)[] {
	if (!argString) return [];
	const content = argString.trim().replace(/^\((.*)\)$/, '$1');
	const args: (string | number)[] = [];
	let current = '';
	let quoteChar: string | null = null;
	for (let i = 0; i < content.length; i++) {
		const char = content[i];
		if (char === '"' || char === "'") {
			if (quoteChar === char) quoteChar = null;
			else if (!quoteChar) quoteChar = char;
		} else if (char === ',' && !quoteChar) {
			args.push(cleanQuote(current));
			current = '';
			continue;
		}
		current += char;
	}
	if (current) args.push(cleanQuote(current));

	return args;
}

/**
 * Clean the string by removing the outer quotes if they exist.
 * Also converts numeric strings to numbers.
 * @param str - The string to clean
 * @returns The cleaned string or number if the string represents a number
 */
function cleanQuote(str: string): string | number {
	str = str.trim();
	if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
		return str.slice(1, -1);
	}

	if (!isNaN(Number(str))) return Number(str);
	return str;
}

type FilterValue = string | number | string[] | number[] | boolean | null | undefined;
type FilterFunction = (value: FilterValue, ...args: unknown[]) => FilterValue;

/**
 * Registry of filter functions available for template value transformation.
 * Each filter takes a value and optional arguments, returning a transformed value.
 */
const filters: Record<string, FilterFunction> = {
	date: (val: FilterValue, format?: unknown, inputFormat?: unknown) => {
		const formatStr = typeof format === 'string' ? format : "YYYY-MM-DD";
		const inputFormatStr = typeof inputFormat === 'string' ? inputFormat : undefined;
		const valStr = typeof val === 'string' || typeof val === 'number' ? val : String(val);
		const m = inputFormatStr ? moment(valStr, inputFormatStr) : moment(valStr);
		return m.isValid() ? m.format(formatStr) : val;
	},
	date_modify: (val: string, modification: string) => {
		const parts = modification.trim().split(" ");
		const amount = parseInt(parts[0]);
		const unit = parts[1] as moment.unitOfTime.DurationConstructor;
		const m = moment(val);
		return m.isValid() ? m.add(amount, unit).format("YYYY-MM-DD") : val;
	},

	capitalize: (val: string) => String(val).charAt(0).toUpperCase() + String(val).slice(1).toLowerCase(),
	upper: (val: string) => String(val).toUpperCase(),
	lower: (val: string) => String(val).toLowerCase(),
	title: (val: string) => String(val).replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()),
	camel: (val: string) => String(val).toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_m: string, chr: string) => chr.toUpperCase()),
	kebab: (val: string) => splitWords(String(val))?.join('-') || val,
	snake: (val: string) => splitWords(String(val))?.join('_') || val,
	trim: (val: string) => String(val).trim(),

	replace: (val: FilterValue, search: unknown, replaceWith?: unknown) => {
		const searchStr = (typeof search === 'string' || typeof search === 'number') ? String(search) : "";
		const replaceStr = (typeof replaceWith === 'string' || typeof replaceWith === 'number') ? String(replaceWith) : "";
		if (searchStr.startsWith("/") && searchStr.lastIndexOf("/") > 0) {
			const lastSlash = searchStr.lastIndexOf("/");
			const pattern = searchStr.substring(1, lastSlash);
			const flags = searchStr.substring(lastSlash + 1);
			try {
				return String(val).replace(new RegExp(pattern, flags), replaceStr);
			} catch {
				return String(val).replace(new RegExp(escapeRegExp(searchStr), 'g'), replaceStr);
			}
		}
		return String(val).replace(new RegExp(escapeRegExp(searchStr), 'g'), replaceStr);
	},

	wikilink: (val: FilterValue, alias?: unknown) => {
		const aliasStr = typeof alias === 'string' ? alias : undefined;
		if (Array.isArray(val)) return val.map(v => `[[${v}${aliasStr ? '|' + aliasStr : ''}]]`).join(", ");
		return `[[${val}${aliasStr ? '|' + aliasStr : ''}]]`;
	},
	link: (val: FilterValue, text?: unknown) => {
		const label = typeof text === 'string' ? text : "link";
		if (Array.isArray(val)) return val.map(v => formatMarkdownLink(String(v), label)).join(", ");
		return formatMarkdownLink(String(val), label);
	},
	image: (val: FilterValue, alt?: unknown) => {
		const txt = typeof alt === 'string' ? alt : "";
		if (Array.isArray(val)) return val.map(v => formatMarkdownImage(String(v), txt)).join("\n");
		return formatMarkdownImage(String(val), txt);
	},
	blockquote: (val: string) => val.split('\n').map(line => `> ${line}`).join('\n'),

	strip_tags: (val: FilterValue) => {
		return stripHtmlTags(String(val));
	},

	split: (val: FilterValue, separator?: unknown) => String(val).split(typeof separator === 'string' ? separator : ","),
	join: (val: FilterValue, separator?: unknown) => Array.isArray(val) ? val.join(typeof separator === 'string' ? separator : ",") : val,
	first: (val: FilterValue) => Array.isArray(val) ? val[0] : val,
	last: (val: FilterValue) => Array.isArray(val) ? val[val.length - 1] : val,
	slice: (val: FilterValue, start?: unknown, end?: unknown) => {
		const startNum = typeof start === 'number' ? start : 0;
		const endNum = typeof end === 'number' ? end : undefined;
		if (typeof val === 'string') return val.slice(startNum, endNum);
		if (Array.isArray(val)) return val.slice(startNum, endNum);
		return val;
	},
	count: (val: FilterValue) => Array.isArray(val) ? val.length : String(val).length,

	calc: (val: number, opString: string) => {
		const trimmed = opString.trim();
		const base = parseFloat(String(val));
		if (isNaN(base)) return val;

		if (trimmed.startsWith("**")) {
			const num = parseFloat(trimmed.substring(2));
			return isNaN(num) ? val : Math.pow(base, num);
		}

		const op = trimmed.charAt(0);
		const num = parseFloat(trimmed.substring(1));
		if (isNaN(num)) return val;

		switch (op) {
			case '+': return base + num;
			case '-': return base - num;
			case '*': return base * num;
			case '/': return base / num;
			case '^': return Math.pow(base, num);
			default: return val;
		}
	},

	// --- Additional Clipper-style filters ---

	// String case
	pascal: (val: FilterValue) => {
		return splitWords(String(val))?.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('') || val;
	},
	uncamel: (val: FilterValue) => {
		return String(val).replace(/([A-Z])/g, ' $1').trim().toLowerCase();
	},

	// Array operations
	map: (val: FilterValue, property?: unknown) => {
		if (!Array.isArray(val)) return val;
		if (typeof property === 'string') {
			return val.map(item => {
				if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
					return (item as Record<string, unknown>)[property] ?? null;
				}
				return null;
			}) as FilterValue;
		}
		return val;
	},
	unique: (val: FilterValue) => {
		if (!Array.isArray(val)) return val;
		const result: string[] = [...new Set(val.map(v => String(v)))];
		return result;
	},
	list: (val: FilterValue) => {
		if (Array.isArray(val)) return val;
		return [String(val)];
	},
	nth: (val: FilterValue, n?: unknown) => {
		if (!Array.isArray(val)) return val;
		const idx = typeof n === 'number' ? n : 0;
		return idx >= 0 && idx < val.length ? val[idx] : null;
	},
	merge: (val: FilterValue, ...rest: unknown[]) => {
		if (!Array.isArray(val)) return val;
		const result: string[] = val.map(v => String(v));
		for (const item of rest) {
			if (Array.isArray(item)) {
				result.push(...item.map((v: unknown) => String(v)));
			} else if (item !== undefined) {
				if (typeof item === 'object') {
					result.push(JSON.stringify(item));
				} else if (typeof item === 'string') {
					result.push(item);
				} else if (typeof item === 'number' || typeof item === 'boolean' || typeof item === 'bigint') {
					result.push(String(item));
				}
			}
		}
		return result;
	},
	reverse: (val: FilterValue) => {
		if (Array.isArray(val)) return [...val].reverse() as FilterValue;
		if (typeof val === 'string') return val.split('').reverse().join('');
		return val;
	},
	length: (val: FilterValue) => {
		if (Array.isArray(val)) return val.length;
		if (typeof val === 'string') return val.length;
		return 0;
	},

	// Numeric
	round: (val: FilterValue, decimals?: unknown) => {
		const n = parseFloat(String(val));
		if (isNaN(n)) return val;
		const d = typeof decimals === 'number' ? decimals : 0;
		const factor = Math.pow(10, d);
		return Math.round(n * factor) / factor;
	},
	number_format: (val: FilterValue, decimals?: unknown, decPoint?: unknown, thousandsSep?: unknown) => {
		const n = parseFloat(String(val));
		if (isNaN(n)) return val;
		const d = typeof decimals === 'number' ? decimals : 0;
		const dp = typeof decPoint === 'string' ? decPoint : '.';
		const ts = typeof thousandsSep === 'string' ? thousandsSep : ',';
		const fixed = n.toFixed(d);
		const [intPart, fracPart] = fixed.split('.');
		const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ts);
		return fracPart ? withSep + dp + fracPart : withSep;
	},

	// Date/Time
	duration: (val: FilterValue) => {
		const ms = parseFloat(String(val));
		if (isNaN(ms)) return val;
		const dur = moment.duration(ms);
		const parts: string[] = [];
		if (dur.years()) parts.push(`${dur.years()}y`);
		if (dur.months()) parts.push(`${dur.months()}mo`);
		if (dur.days()) parts.push(`${dur.days()}d`);
		if (dur.hours()) parts.push(`${dur.hours()}h`);
		if (dur.minutes()) parts.push(`${dur.minutes()}m`);
		if (dur.seconds()) parts.push(`${dur.seconds()}s`);
		return parts.join(' ') || '0s';
	},

	// Markdown
	callout: (val: FilterValue, type?: unknown, title?: unknown) => {
		const calloutType = typeof type === 'string' ? type : 'info';
		const calloutTitle = typeof title === 'string' ? title : '';
		const header = calloutTitle ? `> [!${calloutType}] ${calloutTitle}` : `> [!${calloutType}]`;
		const body = String(val).split('\n').map(line => `> ${line}`).join('\n');
		return `${header}\n${body}`;
	},
	footnote: (val: FilterValue, id?: unknown) => {
		const noteId = typeof id === 'string' ? id : String(Math.random()).substring(2, 8);
		return `[^${noteId}]: ${String(val)}`;
	},
	fragment_link: (val: FilterValue, fragment?: unknown) => {
		const frag = typeof fragment === 'string' ? fragment.trim() : '';
		return frag ? `[[${String(val)}#${frag}]]` : `[[${String(val)}]]`;
	},
	markdown: (val: FilterValue) => {
		// Basic HTML to Markdown conversion
		let str = String(val);
		const linkPlaceholders: string[] = [];
		str = str.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
		str = str.replace(/<b>(.*?)<\/b>/gi, '**$1**');
		str = str.replace(/<em>(.*?)<\/em>/gi, '*$1*');
		str = str.replace(/<i>(.*?)<\/i>/gi, '*$1*');
		str = str.replace(/<a href="(.*?)">(.*?)<\/a>/gi, (_m: string, href: string, text: string) => {
			const token = `@@CUSTOM_VIEWS_MARKDOWN_LINK_${linkPlaceholders.length}@@`;
			linkPlaceholders.push(formatMarkdownLink(href, text));
			return token;
		});
		str = str.replace(/<br\s*\/?>/gi, '\n');
		str = str.replace(/<p>(.*?)<\/p>/gi, '$1\n\n');
		str = str.replace(/<h([1-6])>(.*?)<\/h\1>/gi, (_m: string, level: string, text: string) => '#'.repeat(parseInt(level)) + ' ' + text + '\n');
		str = str.replace(/<li>(.*?)<\/li>/gi, '- $1\n');
		str = stripHtmlTags(str);
		str = str.replace(/@@CUSTOM_VIEWS_MARKDOWN_LINK_(\d+)@@/g, (_m: string, index: string) => linkPlaceholders[Number(index)] ?? '');
		return str.trim();
	},
	strip_md: (val: FilterValue) => {
		let str = String(val);
		str = str.replace(/#{1,6}\s/g, '');
		str = str.replace(/(\*\*|__)(.*?)\1/g, '$2');
		str = str.replace(/(\*|_)(.*?)\1/g, '$2');
		str = str.replace(/~~(.*?)~~/g, '$1');
		str = str.replace(/`{1,3}(.*?)`{1,3}/g, '$1');
		str = str.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
		str = str.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
		str = str.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m: string, target: string, display: string) => display || target);
		str = str.replace(/^>\s/gm, '');
		str = str.replace(/^[-*+]\s/gm, '');
		str = str.replace(/^\d+\.\s/gm, '');
		return str;
	},
	table: (val: FilterValue) => {
		// Convert a 2D array into a markdown table
		if (!Array.isArray(val)) return val;
		const rows = val.map(row => {
			if (Array.isArray(row)) return '| ' + row.map(cell => String(cell)).join(' | ') + ' |';
			return '| ' + String(row) + ' |';
		});
		if (rows.length > 0) {
			const firstRow = Array.isArray(val[0]) ? val[0] : [val[0]];
			const separator = '| ' + firstRow.map(() => '---').join(' | ') + ' |';
			return [rows[0], separator, ...rows.slice(1)].join('\n');
		}
		return '';
	},

	// HTML processing
	remove_html: (val: FilterValue) => {
		return stripHtmlTags(String(val));
	},
	remove_tags: (val: FilterValue, ...tagsToRemove: unknown[]) => {
		let str = String(val);
		for (const tag of tagsToRemove) {
			if (typeof tag === 'string') {
				const tagName = normalizeHtmlName(tag);
				if (!tagName) continue;
				const escapedTag = escapeRegExp(tagName);
				const pairRegex = new RegExp(`<${escapedTag}\\b[^>]*>[\\s\\S]*?<\\/${escapedTag}>`, 'gi');
				const openRegex = new RegExp(`<${escapedTag}\\b[^>]*\\/?>`, 'gi');
				const closeRegex = new RegExp(`<\\/${escapedTag}>`, 'gi');
				str = str.replace(pairRegex, '').replace(openRegex, '').replace(closeRegex, '');
			}
		}
		return str;
	},
	strip_attr: (val: FilterValue, ...attrsToStrip: unknown[]) => {
		let str = String(val);
		if (attrsToStrip.length === 0) {
			// Strip all attributes
			str = str.replace(/<(\w+)\s[^>]*>/g, '<$1>');
		} else {
			for (const attr of attrsToStrip) {
				if (typeof attr === 'string') {
					const attrName = normalizeHtmlName(attr);
					if (!attrName) continue;
					const regex = new RegExp(`\\s${escapeRegExp(attrName)}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, 'gi');
					str = str.replace(regex, '');
				}
			}
		}
		return str;
	},
	remove_attr: (val: FilterValue, ...attrsToRemove: unknown[]) => {
		// Alias for strip_attr
		return filters.strip_attr(val, ...attrsToRemove);
	},
	replace_tags: (val: FilterValue, oldTag?: unknown, newTag?: unknown) => {
		if (typeof oldTag !== 'string' || typeof newTag !== 'string') return val;
		const oldTagName = normalizeHtmlName(oldTag);
		const newTagName = normalizeHtmlName(newTag);
		if (!oldTagName || !newTagName) return val;
		let str = String(val);
		const oldTagPattern = escapeRegExp(oldTagName);
		str = str.replace(new RegExp(`<${oldTagPattern}(\\s[^>]*)?>`, 'gi'), `<${newTagName}$1>`);
		str = str.replace(new RegExp(`</${oldTagPattern}>`, 'gi'), `</${newTagName}>`);
		return str;
	},
	unescape: (val: FilterValue) => {
		return unescapeHtmlEntitiesOnce(String(val));
	},

	// Object / Utility
	object: (val: FilterValue) => {
		// Convert key-value pairs to object
		if (Array.isArray(val) && val.length >= 2) {
			const obj: Record<string, FilterValue> = {};
			for (let i = 0; i < val.length - 1; i += 2) {
				obj[String(val[i])] = val[i + 1];
			}
			return JSON.stringify(obj);
		}
		if (typeof val === 'string') {
			try {
				JSON.parse(val);
				return val;
			} catch {
				return val;
			}
		}
		return val;
	},
	template: (val: FilterValue, templateStr?: unknown) => {
		if (typeof templateStr !== 'string') return val;
		return templateStr.replace(/\{\{value\}\}/g, String(val));
	},
	safe_name: (val: FilterValue) => {
		return String(val)
			.replace(/[<>:"/\\|?*]/g, '-')
			.replace(/\s+/g, ' ')
			.trim();
	},
	html_to_json: (val: FilterValue) => {
		// Basic HTML to JSON structure
		const str = String(val);
		const doc = new DOMParser().parseFromString(str, 'text/html');
		const body = doc.body;
		function nodeToJson(node: Element): Record<string, unknown> {
			const result: Record<string, unknown> = { tag: node.tagName.toLowerCase() };
			if (node.attributes.length > 0) {
				const attrs: Record<string, string> = {};
				for (let i = 0; i < node.attributes.length; i++) {
					attrs[node.attributes[i].name] = node.attributes[i].value;
				}
				result.attributes = attrs;
			}
			const children: unknown[] = [];
			node.childNodes.forEach(child => {
				if (child.nodeType === 3) {
					const text = child.textContent?.trim();
					if (text) children.push(text);
				} else if (child.nodeType === 1) {
					children.push(nodeToJson(child as Element));
				}
			});
			if (children.length > 0) result.children = children;
			return result;
		}
		const children: unknown[] = [];
		body.childNodes.forEach(child => {
			if (child.nodeType === 1) children.push(nodeToJson(child as Element));
			else if (child.nodeType === 3 && child.textContent?.trim()) children.push(child.textContent.trim());
		});
		return JSON.stringify(children.length === 1 ? children[0] : children);
	}
};

/**
 * Applies a chain of filters to a value.
 * Filters are separated by pipes (|) and can include arguments after a colon.
 *
 * @param value - The value to transform
 * @param filterChain - Pipe-separated filter chain (e.g., "upper | replace:\"old\",\"new\"")
 * @returns The transformed value after applying all filters in sequence
 *
 * @example
 * applyFilterChain("hello", "upper") // Returns: "HELLO"
 * applyFilterChain("  test  ", "trim | upper") // Returns: "TEST"
 * applyFilterChain(1234567890, "date:\"YYYY-MM-DD\"") // Returns formatted date
 */
export function applyFilterChain(value: FilterValue, filterChain: string): FilterValue {
	if (!filterChain) return value;

	const steps: string[] = [];
	let current = '';
	let quoteChar: string | null = null;

	for (let i = 0; i < filterChain.length; i++) {
		const char = filterChain[i];
		if (char === '"' || char === "'") {
			if (quoteChar === char) quoteChar = null;
			else if (!quoteChar) quoteChar = char;
		}

		if (char === '|' && !quoteChar) {
			steps.push(current.trim());
			current = '';
		} else {
			current += char;
		}
	}
	if (current) steps.push(current.trim());

	let result = value;

	for (const step of steps) {
		if (!step) continue;

		const colonIndex = step.indexOf(':');
		let name = step;
		let args: (string | number)[] = [];

		if (colonIndex > -1) {
			name = step.substring(0, colonIndex);
			const argString = step.substring(colonIndex + 1);
			args = parseArgs(argString);
		}

		const fn = filters[name];
		if (fn) {
			try {
				result = fn(result, ...args);
			} catch (e) {
				console.error(`[Custom Views] Filter error '${name}':`, e);
			}
		}
	}

	return result;
}
