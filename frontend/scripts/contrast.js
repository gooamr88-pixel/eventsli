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
 * CIE L*, the perceptual lightness axis — 0 is black, 100 is white.
 *
 * ADDED 2026-09-06, and it measures the thing this file previously could not
 * see. WCAG contrast ratio answers "can someone read this", and it is heavily
 * COMPRESSED at the light end: #f8fafc against #f1f5f9 is 1.05:1, and so is
 * every other pair of near-whites, so the number cannot tell a deliberate
 * tone change from no tone change at all.
 *
 * That blind spot had a real cost. The light theme shipped three grounds
 * inside 1.8 L* of each other, page.jsx documented a five-band alternating
 * rhythm across them, and every contrast check passed at 17:1 while the bands
 * were invisible. The gate said the page was fine because the only question
 * it knew how to ask was whether the text was legible.
 */
function lightness(hex) {
  const y = luminance(hex);
  return y <= 0.008856 ? 903.3 * y : 116 * y ** (1 / 3) - 16;
}

/** How far apart two grounds are, perceptually. */
function toneGap(a, b) {
  return Math.abs(lightness(a) - lightness(b));
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

  /**
   * Follow `var()` hops until a hex.
   *
   * This used to allow exactly ONE hop, which was true of every role when it
   * was written and stopped being true the moment a band scope could say
   * `--es-bg: var(--es-bg-deep)` — a role pointing at another role, which
   * points at a primitive. Two hops threw "resolves to var(--es-forest-900),
   * which is not a hex" and the gate failed on correct CSS.
   *
   * Each hop is looked up in the scope first and then in `:root`, which is
   * what the cascade actually does for an inherited custom property: a band
   * overrides what it names and inherits the rest. The depth cap turns a
   * circular definition into a legible error rather than a hang.
   */
  const resolve = (scope, name) => {
    let value = scope[name];
    if (!value) throw new Error(`contrast: ${name} is not declared`);

    for (let hop = 0; hop < 8; hop += 1) {
      const ref = value.match(/^var\((--[\w-]+)\)$/);
      if (!ref) break;
      const next = scope[ref[1]] ?? light[ref[1]];
      if (!next) throw new Error(`contrast: ${name} -> ${ref[1]}, which is not declared`);
      value = next;
    }

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

  /**
   * A BAND is a scope too, and until 2026-09-06 none of them was measured.
   *
   * `.es-band--ink` inverts nine text roles inside itself and had never been
   * checked by anything — it happened to be correct, which is luck, not a
   * gate. `.es-band--field` then added a second one. A band that redefines
   * `--es-text-muted` is exactly as able to fail AA as a theme is, and it is
   * MORE likely to: whoever writes one is looking at the heading.
   *
   * Bands inherit from the light scope and override part of it, so that is
   * how the scope is built here. The band must declare its own `--es-bg`
   * (see the note in globals.css) or it has no ground to be measured
   * against and this throws.
   */
  // A band is measured ONCE PER THEME, and the first run of this proved why.
  // `.es-band--field` sets `--es-bg: var(--es-bg-deep)`, and `--es-bg-deep`
  // is itself a role with a different value in each theme (forest-900 in
  // light, forest-800 in dark). Resolving the band against the light scope
  // only, then comparing it to the DARK page, reported the field band as 2.6
  // L* from its own background — a failure that described a combination that
  // never renders. The band inherits from whichever theme it sits in, so
  // that is what it is resolved against.
  const band = (scope, selector) => (
    { ...scope, ...declarations(blockAfter(src, selector)) }
  );

  return {
    light: roles(light),
    dark: roles(dark),
    'ink@light': roles(band(light, '.es-band--ink {')),
    'ink@dark': roles(band(dark, '.es-band--ink {')),
    'field@light': roles(band(light, '.es-band--field {')),
    'field@dark': roles(band(dark, '.es-band--field {')),
  };
}

const THEMES = readThemes();

const GROUNDS = ['bg', 'bg-sunken', 'surface'];
const TEXT_ROLES = ['ink', 'muted', 'subtle', 'accent'];

/** 4.5 for body copy. Large text is allowed 3, and every place this codebase
 *  uses a text role at a large size is listed rather than assumed. */
const AA_BODY = 4.5;

/**
 * The floor for two grounds that are meant to read as different bands.
 *
 * 3.0 is not a standards number — there is no WCAG rule for this, because
 * WCAG is about legibility and this is about whether a design decision is
 * visible at all. It is the point below which a tone change stops being
 * perceptible on a normal screen. The old light theme sat at 1.8 and the old
 * dark theme at 2.5; both are why the app read as one flat sheet.
 *
 * Only ADJACENT tones in the alternation are checked. `surface` on `bg` is
 * deliberately below this — a white card on the paper ground is carried by
 * its border, and card grids sit on `bg-sunken`, where the gap is 7.5.
 */
const TONE_FLOOR = 3.0;

/** The ground pairs a page actually alternates between, per theme. */
const TONE_PAIRS = [
  ['light', 'bg', 'bg-sunken'],
  ['light', 'bg-sunken', 'surface'],
  ['dark', 'bg', 'bg-sunken'],
  ['dark', 'bg', 'surface'],
];

function check() {
  const failures = [];
  const rows = [];
  const tones = [];

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

  // ── Tone separation ───────────────────────────────────────────────────
  // Everything above asks "is this readable". This asks "is this visible",
  // which is the question the flat version of this palette passed by
  // default because nothing was posing it.
  for (const [theme, a, b] of TONE_PAIRS) {
    const gap = toneGap(THEMES[theme][a], THEMES[theme][b]);
    const pass = gap >= TONE_FLOOR;
    tones.push({ theme, a, b, gap, pass });
    if (!pass) {
      failures.push(
        `${theme}: bg-${a} and bg-${b} are ${gap.toFixed(1)} L* apart `
        + `(needs ${TONE_FLOOR}) — these two bands look identical`,
      );
    }
  }

  // A dark band has to separate from the page it interrupts, in the theme it
  // interrupts it in. On a light page that is trivially true; on a dark page
  // a --field band is otherwise just more dark theme, which is the whole
  // failure this band exists to fix, reintroduced one theme over.
  for (const [theme, scope] of [['light', 'field@light'], ['dark', 'field@dark']]) {
    const gap = toneGap(THEMES[scope].bg, THEMES[theme].bg);
    const pass = gap >= TONE_FLOOR;
    tones.push({
      theme, a: 'band--field', b: 'page bg', gap, pass,
    });
    if (!pass) {
      failures.push(
        `${theme}: .es-band--field and the page ground are ${gap.toFixed(1)} L* apart `
        + `(needs ${TONE_FLOOR}) — the field band does not read as a band here`,
      );
    }
  }

  return { rows, tones, failures };
}

module.exports = {
  luminance, lightness, ratio, toneGap, check, THEMES, AA_BODY, TONE_FLOOR,
};

if (require.main === module) {
  const { rows, tones, failures } = check();

  for (const row of rows) {
    console.log(
      `  ${row.pass ? 'pass' : 'FAIL'}  ${row.theme.padEnd(11)} ${String(row.role).padEnd(10)}`
      + ` on ${String(row.ground).padEnd(14)} ${row.ratio.toFixed(2)}:1`,
    );
  }

  console.log('\n  tone separation (perceptual lightness, floor '
    + `${TONE_FLOOR.toFixed(1)} L*)`);
  for (const t of tones) {
    console.log(
      `  ${t.pass ? 'pass' : 'FAIL'}  ${t.theme.padEnd(11)} ${String(t.a).padEnd(12)}`
      + ` vs ${String(t.b).padEnd(12)} ${t.gap.toFixed(1)} L*`,
    );
  }

  if (failures.length === 0) {
    console.log('\ncontrast: every text role meets AA on every ground, in both themes '
      + 'and both dark bands; every alternating pair is perceptibly apart');
    process.exit(0);
  }

  console.error(`\n${failures.length} contrast failure(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(process.argv.includes('--strict') ? 1 : 0);
}
