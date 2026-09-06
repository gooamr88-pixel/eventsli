/**
 * One-off repair: undo cp1252 mojibake introduced by `Get-Content -Raw` +
 * `Set-Content -Encoding utf8` in Windows PowerShell 5.1.
 *
 * `Get-Content -Raw` decodes a BOM-less file as cp1252, so the three bytes of
 * `─` (E2 94 80) become three characters, and writing them back as UTF-8 makes
 * six bytes. Reversible exactly: re-encode the string as latin1 and decode the
 * result as UTF-8.
 *
 * Kept out of `npm run check` — it is a repair, not a check. encodingCheck.js
 * is what stops it happening again.
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * cp1252 is NOT latin1, and the difference is the whole repair.
 *
 * They agree everywhere except bytes 0x80–0x9F, where latin1 has C1 control
 * codes and cp1252 has printable characters — €, the curly quotes, the dashes,
 * the bullet. Those are exactly the bytes a UTF-8 multi-byte sequence is made
 * of, so they are exactly the ones that appear in the mojibake. Reversing with
 * latin1 throws before it starts.
 */
const CP1252_HIGH = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
  0x017E: 0x9E, 0x0178: 0x9F,
};

/** @returns {Buffer|null} null when a character has no cp1252 byte, which
 *  means the text was never mojibake in the first place. */
function toCp1252(text) {
  const bytes = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.codePointAt(i);
    if (code > 0xFFFF) return null;
    if (CP1252_HIGH[code] !== undefined) bytes[i] = CP1252_HIGH[code];
    else if (code < 0x100) bytes[i] = code;
    else return null;
  }
  return bytes;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/_fixEncoding.js <file>...');
  process.exit(1);
}

for (const file of files) {
  const full = path.resolve(file);
  const text = fs.readFileSync(full, 'utf8');
  const bytes = toCp1252(text);

  if (!bytes) {
    console.log(`${file}  holds characters cp1252 cannot encode — not mojibake, left alone`);
    continue;
  }

  let repaired = null;
  try {
    repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    /**
     * A MIXED file: some text was round-tripped through cp1252 and some was
     * written correctly afterwards. Reversing the whole thing fails on the
     * clean part, so fall back to replacing the mojibake sequences that
     * actually occur. Narrow on purpose — a broad rule here would "repair"
     * text that was always fine.
     */
    const SEQUENCES = [
      ['â€”', '—'],   // em dash
      ['â€“', '–'],   // en dash
      ['â€', '“'],   // left double quote
      ['â€', '”'],   // right double quote
      ['â€¦', '…'],   // ellipsis
      ['Â§', '§'],         // section sign
      ['Â·', '·'],         // middle dot
    ];
    repaired = SEQUENCES.reduce((acc, [bad, good]) => acc.split(bad).join(good), text);
    if (repaired === text) {
      console.log(`${file}  does not decode as UTF-8 and matches no known sequence — left alone`);
      continue;
    }
  }

  if (repaired === text) {
    console.log(`${file}  already clean`);
    continue;
  }

  fs.writeFileSync(full, repaired, 'utf8');
  console.log(`${file}  repaired (${text.length} -> ${repaired.length} chars)`);
}
