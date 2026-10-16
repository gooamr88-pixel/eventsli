import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { render } from '@testing-library/react';
import Logo from '../src/app/components/brand/Logo';
import { MARK_FRAME, MARK_STAR } from '../src/app/components/brand/markPath';
import { WORDMARK_EVENTS, WORDMARK_LI } from '../src/app/components/brand/wordmarkPath';

/**
 * The brand guide (Via Marketing, 2026-10-16) as things a build can check.
 *
 * Every assertion here is a rule from the guide that the code could quietly
 * break: the logo's shapes, its colours, and the four brand values. A logo is
 * the one asset nobody re-reviews once it ships, so the review lives here.
 */
const read = (...p) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');

describe('the logo', () => {
  test('the two-colour word is the traced artwork, split and not edited', () => {
    // sha256 of the single path the wordmark was before the split. "Events" +
    // "li★" concatenated must be that path byte for byte.
    const whole = WORDMARK_EVENTS + WORDMARK_LI;
    expect(crypto.createHash('sha256').update(whole).digest('hex'))
      .toBe('0db8843900cf0859af22a9e901b38630b04707c622b0f744897330c8f54e8fb0');
    // E v e n t s | l i star
    expect(WORDMARK_EVENTS.match(/M/g)).toHaveLength(6);
    expect(WORDMARK_LI.match(/M/g)).toHaveLength(3);
  });

  test('the favicon carries the same framed star as the masthead', () => {
    const icon = read('src', 'app', 'icon.svg');
    expect(icon).toContain(`d="${MARK_FRAME}"`);
    expect(icon).toContain(`d="${MARK_STAR}"`);
    expect(icon).toContain('fill="#0d5b5e"');
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

  test('the four colours are the guide\'s, exactly', () => {
    expect(value('--es-teal-700')).toBe('#0d5b5e');   // Teal
    expect(value('--es-black')).toBe('#000000');      // Black
    expect(value('--es-bg')).toBe('#ffffff');         // White
    expect(value('--es-grey-100')).toBe('#f2f4f5');   // Light Grey
  });

  test('the accent IS the brand teal, not a lighter "web" version of it', () => {
    expect(value('--es-accent')).toBe('var(--es-teal-700)');
    expect(value('--es-bg-sunken')).toBe('var(--es-grey-100)');
  });

  test('the logo is full colour by default', () => {
    expect(value('--es-logo-mark')).toBe('var(--es-teal-700)');
    expect(value('--es-logo-ink')).toBe('var(--es-black)');
    expect(value('--es-logo-li')).toBe('var(--es-teal-700)');
  });

  test('no blue-era ramp survives', () => {
    expect(css).not.toMatch(/--es-(blue|mist|navy)-\d/);
  });
});
