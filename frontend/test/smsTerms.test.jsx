import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import SmsTermsPage from '../src/app/sms-terms/page';
import { CONSENT_TEXT, consentText } from '../src/app/lib/smsConsentText';

/**
 * /sms-terms is the public opt-in link a carrier registration points at. It
 * must quote the consent boxes as they really are and name the keywords the
 * server really answers — a page that drifts from the software is a page a
 * reviewer can catch.
 */

describe('text message terms', () => {
  test('quotes every checkout and sign-up consent box word for word', () => {
    const { container } = render(<SmsTermsPage />);
    const text = container.textContent;
    const shown = Object.keys(CONSENT_TEXT).filter((k) => /^(checkout|registration)\./.test(k));
    expect(shown.length).toBeGreaterThanOrEqual(5);
    for (const version of shown) {
      expect(text, version).toContain(consentText(version, { organizer: 'the event organizer' }));
    }
  });

  test('every keyword it names is one the server answers', () => {
    const src = readFileSync(resolve(__dirname, '../../backend/services/sms/keywords.js'), 'utf8');
    const words = (name) => new Set([...src.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
    const stop = words('STOP');
    const start = words('START');
    const help = words('HELP');
    for (const w of ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'STOPALL']) expect(stop.has(w), w).toBe(true);
    expect(start.has('START')).toBe(true);
    expect(help.has('HELP')).toBe(true);

    render(<SmsTermsPage />);
    for (const w of ['STOP', 'UNSUBSCRIBE', 'START', 'HELP']) expect(screen.getAllByText(w).length, w).toBeGreaterThan(0);
  });

  test('states the rates line and links to the privacy policy', () => {
    const { container } = render(<SmsTermsPage />);
    expect(container.textContent).toContain('Message and data rates may apply');
    expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
  });
});
