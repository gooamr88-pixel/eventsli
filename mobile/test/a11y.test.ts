/**
 * Screen-reader basics, checked in the source so they cannot quietly lapse:
 * everything pressable says what it is (a button, a link, a switch), and
 * every text field says what it is for. TalkBack and VoiceOver read exactly
 * this; a row with no role is read as text and never offered as a control.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
});

/** Each `<Tag ...>` opening tag in the file, with braces and strings respected. */
function openingTags(src: string, tag: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const re = new RegExp(`<${tag}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + m[0].length;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ line: src.slice(0, m.index).split('\n').length, text: src.slice(m.index, i + 1) });
  }
  return out;
}

const all = files(SRC).map((f) => ({ rel: relative(SRC, f).split(sep).join('/'), src: readFileSync(f, 'utf8') }));

test('the scanner sees the tags it is meant to check', () => {
  expect(all.flatMap((f) => openingTags(f.src, 'Pressable')).length).toBeGreaterThan(10);
});

test.each(all.filter((f) => f.src.includes('<Pressable')).map((f) => [f.rel, f.src]))(
  '%s: every Pressable has an accessibilityRole',
  (_rel, src) => {
    const missing = openingTags(src, 'Pressable').filter((t) => !/accessibilityRole=/.test(t.text));
    expect(missing.map((t) => `line ${t.line}`)).toEqual([]);
  },
);

test.each(all.filter((f) => f.src.includes('<TextInput')).map((f) => [f.rel, f.src]))(
  '%s: every TextInput is labelled',
  (_rel, src) => {
    const missing = openingTags(src, 'TextInput').filter((t) => !/accessibilityLabel=/.test(t.text));
    expect(missing.map((t) => `line ${t.line}`)).toEqual([]);
  },
);

test('every icon-only button has a label', () => {
  const missing = all.flatMap((f) => openingTags(f.src, 'IconButton')
    .filter((t) => !/\blabel=/.test(t.text))
    .map((t) => `${f.rel} line ${t.line}`));
  expect(missing).toEqual([]);
});
