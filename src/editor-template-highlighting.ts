/*!
MIT License

Copyright (c) 2026 Obsidian

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
/** Template tokenization adapted from Obsidian Knap's playground (MIT).
 * See THIRD_PARTY_NOTICES.md. Host HTML/CSS/JS parsing remains intact.
 */
import { StringStream } from "@codemirror/language";
import { StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

interface TokenState { close: string; quote: string; filter: boolean }
const maxHighlightLineLength = 2000;
const tokenizer = {
  startState: () => ({ close: '', quote: '', filter: false }),
  token(stream: StringStream, state: TokenState) {
    if (stream.string.length > maxHighlightLineLength) {
      stream.skipToEnd(); state.close = ''; state.quote = ''; state.filter = false;
      return null;
    }
    if (!state.close) {
      if (stream.match('{{')) state.close = '}}';
      else if (stream.match('{%')) state.close = '%}';
      else if (stream.match('{#')) { state.close = '#}'; return 'comment'; }
      else {
        stream.next();
        return null;
      }
      return 'punctuation';
    }
    if (state.close === '#}') {
      if (stream.skipTo('#}')) { stream.match('#}'); state.close = ''; }
      else stream.skipToEnd();
      return 'comment';
    }
    if (!state.quote && stream.match(state.close)) {
      state.close = ''; state.filter = false;
      return 'punctuation';
    }
    if (state.quote || stream.peek() === '"' || stream.peek() === "'") {
      if (!state.quote) state.quote = stream.next()!;
      while (!stream.eol()) {
        const char = stream.next();
        if (char === '\\') stream.next();
        else if (char === state.quote) { state.quote = ''; break; }
      }
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('||')) return 'operator';
    if (stream.match('|')) { state.filter = true; return 'operator'; }
    if (stream.match(/\d+(?:\.\d+)?/)) return 'number';
    if (stream.match(/[a-zA-Z_$][\w$]*/)) {
      if (state.filter) { state.filter = false; return 'filter'; }
      return /^(if|else|elseif|endif|for|in|endfor|set|and|or|not|contains|true|false|null)$/.test(stream.current()) ? 'keyword' : 'variableName';
    }
    stream.next();
    return 'punctuation';
  },
};


const classes: Record<string, string> = {
	variableName: "cv-syn-variable", filter: "cv-syn-filter", keyword: "cv-syn-keyword",
	string: "cv-syn-string", number: "cv-syn-number", comment: "cv-syn-comment",
	punctuation: "cv-syn-punctuation", operator: "cv-syn-punctuation",
};
interface TokenRange { from: number; to: number; className: string }
interface HighlightLine { text: string; before: TokenState; after: TokenState; tokens: TokenRange[] }
interface TemplateHighlightState { lines: HighlightLine[]; decorations: DecorationSet }
const sameState = (a: TokenState, b: TokenState) => a.close === b.close && a.quote === b.quote && a.filter === b.filter;

function parse(doc: Text, previous: HighlightLine[] = []): TemplateHighlightState {
	let state: TokenState = tokenizer.startState();
	const lines: HighlightLine[] = [];
	const ranges: ReturnType<Decoration["range"]>[] = [];
	const delta = doc.lines - previous.length;
	for (let n = 1; n <= doc.lines; n++) {
		const line = doc.line(n);
		// Reuse unchanged lines, including the suffix shifted by inserted/deleted lines.
		let cached = [previous[n - 1], previous[n - 1 - delta]].find(candidate =>
			candidate?.text === line.text && sameState(candidate.before, state));
		if (!cached) {
			const before = { ...state };
			const tokens: TokenRange[] = [];
			const stream = new StringStream(line.text, 2, 2);
			while (!stream.eol()) {
				stream.start = stream.pos;
				const token = tokenizer.token(stream, state);
				if (token) tokens.push({ from: stream.start, to: stream.pos, className: classes[token] });
			}
			cached = { text: line.text, before, after: { ...state }, tokens };
		}
		state = { ...cached.after };
		lines.push(cached);
		for (const token of cached.tokens) ranges.push(Decoration.mark({ class: token.className }).range(line.from + token.from, line.from + token.to));
	}
	return { lines, decorations: Decoration.set(ranges, true) };
}

export const templateHighlighting = StateField.define<TemplateHighlightState>({
	create: state => parse(state.doc),
	update: (value, transaction) => transaction.docChanged ? parse(transaction.newDoc, value.lines) : value,
	provide: field => EditorView.decorations.from(field, value => value.decorations),
});
