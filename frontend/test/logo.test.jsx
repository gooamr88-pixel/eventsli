import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { render } from '@testing-library/react';
import Logo from '../src/app/components/brand/Logo';
import { MARK_FRAME, MARK_INITIAL } from '../src/app/components/brand/markPath';
import { WORDMARK_EVENTS, WORDMARK_LI } from '../src/app/components/brand/wordmarkPath';

/**
 * The brand sheet (the approved homepage concept, 2026-11-15) as things a
 * build can check.
 *
 * Every assertion here is a rule from the guide that the code could quietly
 * break: the logo's shapes, its colours, and the four brand values. A logo is
 * the one asset nobody re-reviews once it ships, so the review lives here.
 */
const read = (...p) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');

describe('the logo', () => {
  test('the word is the generated Montserrat outline, in two halves', () => {
    // E v e n t s | l i — at least one closed outline per letter, and the
    // halves are separate shapes (the print kit and the CSS address them apart).
    expect(WORDMARK_EVENTS.match(/M/g).length).toBeGreaterThanOrEqual(6);
    expect(WORDMARK_LI.match(/M/g).length).toBeGreaterThanOrEqual(2);
    expect(WORDMARK_EVENTS).not.toContain(WORDMARK_LI);
  });

  test('the favicon carries the same E-ticket as the masthead', () => {
    const icon = read('src', 'app', 'icon.svg');
    expect(icon).toContain(`d="${MARK_FRAME}"`);
    expect(icon).toContain(`d="${MARK_INITIAL}"`);
    expect(icon).toContain('fill="#ffcc00"');
    expect(icon).toContain('fill="#111018"');
  });

  test('no shape carries a colour of its own — the CSS roles decide', () => {
    const { container } = render(<Logo tagline />);
    for (const node of container.querySelectorAll('path, text')) {
      expect(node.getAttribute('fill'), node.outerHTML.slice(0, 60)).toBeNull();
    }
    expect(container.querySelector('.es-logo__events')).not.toBeNull();
    expect(container.querySelector('.es-logo__li')).not.toBeNull();
  });

  test('the tagline is opt-in, and a screen reader hears the name once', () => {
    const bare = render(<Logo />).container;
    expect(bare.textContent).toBe('Eventsli');
    const lockup = render(<Logo tagline />).container;
    expect(lockup.querySelector('.es-logo__tagline').textContent).toBe('DISCOVER - BOOK - ENJOY');
    expect(lockup.querySelector('.es-logo--lockup')).not.toBeNull();
    // Every SVG is decorative; the only accessible text is the sr-only name.
    for (const svg of lockup.querySelectorAll('svg')) expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  test('the mark-only logo has no word and no tagline', () => {
    const { container } = render(<Logo mark tagline />);
    expect(container.querySelector('.es-logo__word')).toBeNull();
    expect(container.querySelector('.es-logo__mark')).not.toBeNull();
  });
});

describe('the brand values in globals.css', () => {
  const css = read('src', 'app', 'globals.css');
  const value = (name) => css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();

  test('the six colours are the sheet\'s, exactly', () => {
    expect(value('--es-bg')).toBe('#ffffff');          // Pure White
    expect(value('--es-sun-400')).toBe('#ffcc00');     // Sunshine Yellow
    expect(value('--es-coral-500')).toBe('#ff414b');   // Coral Red
    expect(value('--es-black')).toBe('#111018');       // Near Black
    expect(value('--es-grey-200')).toBe('#eaeaea');    // Soft Gray
    expect(value('--es-grey-75')).toBe('#f8f8f8');     // Off White
  });

  test('the CTA is the text-safe coral, and the sheet\'s coral stays decorative', () => {
    // #ff414b carries white at 3.44:1 — an AA failure on every button label.
    // See the brand note in globals.css; contrast.js measures the result.
    expect(value('--es-accent')).toBe('var(--es-coral-600)');
    expect(value('--es-brand-coral')).toBe('var(--es-coral-500)');
    expect(value('--es-highlight')).toBe('var(--es-sun-400)');
    expect(value('--es-border')).toBe('var(--es-grey-200)');
  });

  test('the logo is full colour by default', () => {
    expect(value('--es-logo-mark')).toBe('var(--es-sun-400)');
    expect(value('--es-logo-initial')).toBe('var(--es-black)');
    expect(value('--es-logo-ink')).toBe('var(--es-black)');
  });

  test('no earlier ramp survives', () => {
    expect(css).not.toMatch(/--es-(blue|mist|navy|teal)-\d/);
  });
});
