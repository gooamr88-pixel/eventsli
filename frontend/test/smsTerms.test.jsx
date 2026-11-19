import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import SmsTermsPage from '../src/app/sms-terms/page';
import { createRequire } from 'node:module';
import { CONSENT_TEXT, consentText, OPT_IN_CONFIRMATION } from '../src/app/lib/smsConsentText';
import { LEGAL_ENTITY } from '../src/app/lib/siteRoutes';

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

  // The five disclosures the toll-free verification review (Nov 2026) asked for, by name.
  test('carries every disclosure a carrier reviewer checks for', () => {
    const { container } = render(<SmsTermsPage />);
    const text = container.textContent;
    expect(text).toContain('Reply HELP for help');
    expect(text).toContain('Message frequency varies');
    expect(container.querySelector('a[href="/privacy"]').textContent).toBe('Privacy Policy');
    expect(container.querySelector('a[href="/terms"]').textContent).toBe('Terms of Service');
    expect(text).toMatch(/Customer care: info@eventsli\.com/);
    expect(container.querySelector('a[href="mailto:info@eventsli.com"]')).not.toBeNull();
    expect(text).toContain(LEGAL_ENTITY);
  });

  test('quotes the opt-in confirmation exactly as the server sends it', () => {
    const backend = createRequire(import.meta.url)('../../backend/services/sms/consentText.js');
    expect(OPT_IN_CONFIRMATION).toBe(backend.optInConfirmation({ transactional: true }));
    const { container } = render(<SmsTermsPage />);
    expect(container.textContent).toContain(OPT_IN_CONFIRMATION);
    expect(OPT_IN_CONFIRMATION).not.toMatch(/\[|\]|Example/);
  });
});
