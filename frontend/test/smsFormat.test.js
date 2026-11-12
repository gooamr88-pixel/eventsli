import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  analyzeSegments, formatMicros, parseMicros, microsToInput, delta, deliveryRate, describeActivity, relativeTime,
  GSM_BASIC, GSM_EXTENDED, MESSAGE_STATUS, flagOf,
} from '../src/app/lib/smsFormat';
import { adminNavGroups } from '../src/app/admin/nav/adminNav';
import { isPrivatePath } from '../src/app/lib/siteRoutes';

/**
 * The SMS console's pure helpers, and the parity that matters most: the live
 * segment counter must count exactly as the server bills.
 */

const backend = (p) => readFileSync(resolve(__dirname, '../../backend', p), 'utf8');

describe('segments match the backend', () => {
  test('the GSM alphabets are character-for-character the backend’s', () => {
    const src = backend('services/sms/segments.js');
    const basic = /GSM_BASIC = new Set\(Array\.from\(\s*'((?:[^'\\]|\\.)*)'/.exec(src)?.[1];
    const extended = /GSM_EXTENDED = new Set\(Array\.from\('((?:[^'\\]|\\.)*)'\)\)/.exec(src)?.[1];
    expect(basic, 'could not find GSM_BASIC in segments.js').toBeTruthy();
    // Unescape the JS string literal the same way the runtime would.
    const unescape = (s) => JSON.parse(`"${s.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`);
    expect(unescape(basic)).toBe(GSM_BASIC);
    expect(unescape(extended)).toBe(GSM_EXTENDED);
  });

  test('the counts', () => {
    expect(analyzeSegments('a'.repeat(160))).toMatchObject({ encoding: 'GSM-7', segments: 1 });
    expect(analyzeSegments('a'.repeat(161)).segments).toBe(2);
    expect(analyzeSegments('€'.repeat(81)).segments).toBe(2);
    expect(analyzeSegments('مرحبا بكم').encoding).toBe('UCS-2');
    expect(analyzeSegments(`${'a'.repeat(70)}’`).segments).toBe(2);
  });
});

describe('money in micros', () => {
  test('formats small prices with four decimals and totals with two', () => {
    expect(formatMicros(7500, 'USD')).toBe('$0.0075');
    expect(formatMicros(1_248_500_000, 'USD', { precise: 2 })).toBe('$1,248.50');
    expect(formatMicros(null)).toBe('—');
  });
  test('parses typed prices exactly and round-trips', () => {
    expect(parseMicros('0.0075')).toBe(7500);
    expect(parseMicros('1.5')).toBe(1_500_000);
    expect(parseMicros('abc')).toBeNull();
    expect(parseMicros('-1')).toBeNull();
    expect(microsToInput(7500)).toBe('0.0075');
    expect(microsToInput(2_000_000)).toBe('2');
    expect(microsToInput(null)).toBe('');
  });
});

describe('figures', () => {
  test('delta and delivery rate', () => {
    expect(delta(112, 100)).toBeCloseTo(12);
    expect(delta(0, 0)).toBe(0);
    expect(delta(5, 0)).toBeNull();
    expect(deliveryRate({ sent: 200, delivered: 197 })).toBeCloseTo(98.5);
    expect(deliveryRate({ sent: 0, delivered: 0 })).toBeNull();
  });
  test('activity reads as a sentence', () => {
    expect(describeActivity('sms.country.enabled', { iso2: 'FR' })).toBe('Country enabled (FR)');
    expect(describeActivity('sms.something.new')).toBe('something new');
    expect(relativeTime(new Date(Date.now() - 2 * 3_600_000).toISOString())).toBe('2 hours ago');
  });
  test('every message status has a label and a tone', () => {
    const statuses = /CREATE TYPE sms_message_status AS ENUM\s*\(([^)]*)\)/.exec(
      readFileSync(resolve(__dirname, '../../supabase/migrations/20261116090000_sms_platform.sql'), 'utf8'),
    )[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
    for (const s of statuses) expect(MESSAGE_STATUS[s], s).toMatchObject({ label: expect.any(String), tone: expect.any(String) });
  });
  test('flags are regional indicators', () => {
    expect(flagOf('eg')).toBe('🇪🇬');
    expect(flagOf('x')).toBe('');
  });
});

describe('routes', () => {
  test('the console is in the admin nav and the unsubscribe link is never crawled', () => {
    const hrefs = adminNavGroups().flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain('/admin/sms');
    expect(isPrivatePath('/sms/stop/abc.def')).toBe(true);
  });
});
