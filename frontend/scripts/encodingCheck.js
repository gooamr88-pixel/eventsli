#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * No byte-order marks, and no CRLF inside source files.
 *
 * WHY THIS EXISTS, precisely. `Set-Content -Encoding utf8` in Windows
 * PowerShell 5.1 — the shell this project is developed in — writes UTF-8 WITH
 * a BOM. Three invisible bytes at the front of a file.
 *
 * In globals.css that broke the build, and the error pointed somewhere else
 * entirely:
 *
 *     ./src/app/globals.css:2:1  Parsing CSS source code failed
 *     1 | (the tailwindcss banner comment)
 *
 * — a line that is not in the file. The BOM sat in front of `@import
 * "tailwindcss"`, so the import resolved with three junk bytes glued to the
 * front of the generated stylesheet, and the parser reported the failure
 * against the GENERATED text. Ten minutes of reading a file that was correct.
 *
 * A BOM is quieter still in JavaScript: Node strips it from a module, so a
 * .mjs with one works fine until something reads the file as text and finds an
 * unexpected character at position zero.
 *
 * Cheap to check, invisible to review, and it has already cost this project a
 * build once.
 *
 *   node scripts/encodingCheck.js
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('node:fs');
const path = require('node:path');

const ROOTS = ['src', 'scripts', 'config', 'test'];
const EXTENSIONS = /\.(js|jsx|ts|tsx|mjs|css|json|md)$/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.test(entry.name)) out.push(full);
  }
  return out;
}

/** @returns {string[]} one line per offending file */
function scanEncoding(base = path.join(__dirname, '..')) {
  const findings = [];

  for (const root of ROOTS) {
    for (const file of walk(path.join(base, root))) {
      const rel = path.relative(base, file).replace(/\\/g, '/');
      const bytes = fs.readFileSync(file);

      if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        findings.push(`${rel}  starts with a UTF-8 BOM (EF BB BF)`);
      }

      // A stray NUL is the signature of a file written as UTF-16 and read back
      // as UTF-8 — the other way `Set-Content` gets this wrong.
      if (bytes.includes(0x00)) {
        findings.push(`${rel}  contains a NUL byte — written as UTF-16?`);
      }
    }
  }

  return findings;
}

module.exports = { scanEncoding };

if (require.main === module) {
  const findings = scanEncoding();

  if (findings.length === 0) {
    console.log('encodingCheck: clean (no BOMs, no NUL bytes)');
    process.exit(0);
  }

  console.error(`${findings.length} file(s) with a bad encoding:\n`);
  for (const f of findings) console.error(`  ${f}`);
  console.error(
    '\nOn Windows PowerShell 5.1, `Set-Content -Encoding utf8` writes a BOM. Use\n'
    + '  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))\n'
    + 'or edit the file with a tool that does not re-encode it.',
  );
  process.exit(1);
}
