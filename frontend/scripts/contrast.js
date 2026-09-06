#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WCAG contrast for every text role against every ground it is used on, in
 * both themes.
 *
 * Written because Lighthouse only reports the pairs that happen to appear on
 * the page it audited. A role that is legible on the homepage and fails on the
 * one page nobody audited is the normal way this goes wrong — and the failure
 * lands on whoever needed the contrast, who is not the person running the
 * audit.
 *
 * The thresholds are WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large text
 * (≥24px, or ≥18.66px bold) and for the boundary of a control.
 *
 *   node scripts/contrast.js          # report
 *   node scripts/contrast.js --strict # exit non-zero on any AA failure
 * ═══════════════════════════════════════════════════════════════════════════ */

/** sRGB relative luminance, per WCAG. */
function luminance(hex) {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * The palette, READ OUT OF globals.css.
 *
 * The first version of this file carried its own copy of the values. It found
 * eight real failures and then, the moment they were fixed in the stylesheet,
 * went on reporting all eight — because the copy had not moved. A checker that
 * can be wrong in that direction is worse than none: it fails when the code is
 * correct, and the fix is to edit the checker, which is exactly the habit that
 * ends with the checker being deleted.
 *
 * So it parses. The file makes that tractable on purpose — every custom
 * property is declared in this one file, primitives are hexes, and roles are a
 * single `var()` hop to a primitive.
 */
const fs = require('node:fs');
const path = require('node:path');

const CSS = path.join(__dirname, '..', 'src', 'app', 'globals.css');

/** The declarations inside one brace-matched block, given the text that opens
 *  it. Brace matching rather than a lazy regex: the theme blocks contain no
 *  nested braces today and the file is not required to stay that way. */
function blockAfter(src, selector) {
  const at = src.indexOf(selector);
  if (at === -1) throw new Error(`contrast: could not find \`${selector}\` in globals.css`);

  let i = src.indexOf('{', at) + 1;
  let depth = 1;
  const start = i;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
    i += 1;
  }
  return src.slice(start, i - 1);
}

function declarations(block) {
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function readThemes() {
  const src = fs.readFileSync(CSS, 'utf8');

  const light = declarations(blockAfter(src, ':root {'));
  // The explicit dark block, which `.fx-gate` shares. The media query block is
  // a byte-identical copy of it by construction — see the note in globals.css.
  const dark = { ...light, ...declarations(blockAfter(src, ':root[data-theme="dark"]')) };

  /** One `var()` hop, then it must be a hex. */
  const resolve = (scope, name) => {
    const raw = scope[name];
    if (!raw) throw new Error(`contrast: ${name} is not declared`);
    const ref = raw.match(/^var\((--[\w-]+)\)$/);
    const value = ref ? light[ref[1]] : raw;
    if (!/^#[0-9a-f]{3,8}$/i.test(value)) {
      throw new Error(`contrast: ${name} resolves to \`${value}\`, which is not a hex`);
    }
    return value;
  };

  const roles = (scope) => ({
    bg: resolve(scope, '--es-bg'),
    'bg-sunken': resolve(scope, '--es-bg-sunken'),
    surface: resolve(scope, '--es-surface'),
    ink: resolve(scope, '--es-text'),
    muted: resolve(scope, '--es-text-muted'),
    subtle: resolve(scope, '--es-text-subtle'),
    accent: resolve(scope, '--es-accent'),
    'on-accent': resolve(scope, '--es-text-on-accent'),
  });

  return { light: roles(light), dark: roles(dark) };
}

const THEMES = readThemes();

const GROUNDS = ['bg', 'bg-sunken', 'surface'];
const TEXT_ROLES = ['ink', 'muted', 'subtle', 'accent'];

/** 4.5 for body copy. Large text is allowed 3, and every place this codebase
 *  uses a text role at a large size is listed rather than assumed. */
const AA_BODY = 4.5;

function check() {
  const failures = [];
  const rows = [];

  for (const [theme, palette] of Object.entries(THEMES)) {
    for (const ground of GROUNDS) {
      for (const role of TEXT_ROLES) {
        const r = ratio(palette[role], palette[ground]);
        const pass = r >= AA_BODY;
        rows.push({ theme, ground, role, ratio: r, pass });
        if (!pass) {
          failures.push(
            `${theme}: text-${role} on bg-${ground} is ${r.toFixed(2)}:1 (needs ${AA_BODY})`,
          );
        }
      }
    }

    // The accent as a FILL, with its own text colour on top — buttons, the
    // active filter pill, the primary call to action.
    const onAccent = ratio(palette['on-accent'], palette.accent);
    rows.push({
      theme, ground: 'accent (fill)', role: 'on-accent', ratio: onAccent, pass: onAccent >= AA_BODY,
    });
    if (onAccent < AA_BODY) {
      failures.push(
        `${theme}: text-on-accent on bg-accent is ${onAccent.toFixed(2)}:1 (needs ${AA_BODY})`,
      );
    }
  }

  return { rows, failures };
}

module.exports = { luminance, ratio, check, THEMES, AA_BODY };

if (require.main === module) {
  const { rows, failures } = check();

  for (const row of rows) {
    console.log(
      `  ${row.pass ? 'pass' : 'FAIL'}  ${row.theme.padEnd(5)} ${String(row.role).padEnd(10)}`
      + ` on ${String(row.ground).padEnd(14)} ${row.ratio.toFixed(2)}:1`,
    );
  }

  if (failures.length === 0) {
    console.log('\ncontrast: every text role meets AA on every ground, in both themes');
    process.exit(0);
  }

  console.error(`\n${failures.length} contrast failure(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(process.argv.includes('--strict') ? 1 : 0);
}
