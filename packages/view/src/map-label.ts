export type LabelRun = { text: string; code?: true };
export type LabelLine = LabelRun[];
type Measure = (text: string, code?: boolean) => number;

/** Only single-backtick spans are styled; longer delimiters and their contents stay literal. */
export function mapLabel(text: string): LabelLine {
  const markers = [...text.matchAll(/`+/g)], out: LabelLine = [];
  let from = 0;
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i], start = marker.index;
    let escapes = 0;
    for (let p = start - 1; p >= 0 && text[p] === "\\"; p--) escapes++;
    if (escapes % 2) continue;
    const length = marker[0].length;
    let end = i + 1;
    while (end < markers.length && markers[end][0].length !== length) end++;
    if (end === markers.length) {
      if (length > 1) break;
      continue;
    }
    if (length > 1) { i = end; continue; }
    if (start > from) out.push({ text: text.slice(from, start) });
    let code = text.slice(start + 1, markers[end].index).replace(/\r\n?|\n/g, " ");
    if (code.startsWith(" ") && code.endsWith(" ") && /[^ ]/.test(code)) code = code.slice(1, -1);
    out.push({ text: code, code: true });
    from = markers[end].index + 1;
    i = end;
  }
  if (from < text.length) out.push({ text: text.slice(from) });
  return out;
}

export const labelWidth = (line: LabelLine, measure: Measure): number =>
  line.reduce((width, run) => width + measure(run.text, run.code), 0);

function sliceLabel(runs: LabelLine, start: number, end: number): LabelLine {
  const out: LabelLine = [];
  let offset = 0;
  for (const run of runs) {
    const from = Math.max(0, start - offset), to = Math.min(run.text.length, end - offset);
    if (to > from) out.push({ ...run, text: run.text.slice(from, to) });
    offset += run.text.length;
    if (offset >= end) break;
  }
  return out;
}

export function wrapMapLabel(text: string, width: number, limit: number, measure: Measure): LabelLine[] {
  const runs = mapLabel(text), plain = runs.map(run => run.text).join("");
  const tokens = plain.matchAll(/[\u2e80-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]|[^\s\u2e80-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]+|\s+/gu);
  const out: LabelLine[] = [];
  const trimmed = (start: number, end: number) => {
    const line = plain.slice(start, end);
    return sliceLabel(runs, start + line.length - line.trimStart().length, end - line.length + line.trimEnd().length);
  };
  let start = 0, end = 0, truncated = false;
  for (const token of tokens) {
    const next = token.index + token[0].length;
    if (!plain.slice(start, end).trim() || labelWidth(sliceLabel(runs, start, next), measure) <= width) {
      end = next;
      continue;
    }
    out.push(trimmed(start, end));
    if (out.length === limit) { truncated = !!plain.slice(end).trim(); break; }
    start = token.index; end = next;
  }
  if (out.length < limit && plain.slice(start, end).trim()) out.push(trimmed(start, end));
  if (truncated) {
    const last = out[out.length - 1], ellipsis = { text: "\u2026" };
    while (last.length && labelWidth([...last, ellipsis], measure) > width) {
      const run = last[last.length - 1];
      run.text = Array.from(run.text).slice(0, -1).join("");
      if (!run.text) last.pop();
    }
    while (last.length) {
      const run = last[last.length - 1];
      run.text = run.text.replace(/[\s,.;:\uFF0C\u3002\uFF1B\uFF1A\u3001]+$/u, "");
      if (run.text) break;
      last.pop();
    }
    last.push(ellipsis);
  }
  return out;
}
