import { describe, test, expect } from 'vitest';
import { safeExternalUrl, safeContactUrl, safeHref } from '../src/app/utils/safeUrl';

/**
 * The interesting assertions are the negative ones. A URL filter that only
 * proves `https://example.com` survives has proved nothing — every known
 * bypass is a string that LOOKS like it should fail and does not.
 */
describe('safeExternalUrl', () => {
  test('keeps ordinary web URLs', () => {
    expect(safeExternalUrl('https://example.com')).toBe('https://example.com/');
    expect(safeExternalUrl('http://example.com/path?a=1#b')).toBe('http://example.com/path?a=1#b');
    expect(safeExternalUrl('https://sub.example.co.uk/a/b')).toBe('https://sub.example.co.uk/a/b');
  });

  test('refuses executable schemes', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('vbscript:msgbox(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull();
    expect(safeExternalUrl('blob:https://example.com/uuid')).toBeNull();
  });

  test('scheme matching is case-insensitive', () => {
    // `new URL` lowercases the protocol, which is exactly why there is no
    // per-case branch in the module — this test is what says so.
    expect(safeExternalUrl('JavaScript:alert(1)')).toBeNull();
    expect(safeExternalUrl('JAVASCRIPT:alert(1)')).toBeNull();
    expect(safeExternalUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeExternalUrl('HTTPS://example.com')).toBe('https://example.com/');
  });

  test('refuses schemes hidden behind control characters and whitespace', () => {
    // Browsers strip TAB/LF/CR from a URL before acting on it, so a filter that
    // does not strip them first inspects a different string from the one that
    // runs.
    expect(safeExternalUrl('java\tscript:alert(1)')).toBeNull();
    expect(safeExternalUrl('java\nscript:alert(1)')).toBeNull();
    expect(safeExternalUrl('java\rscript:alert(1)')).toBeNull();
    expect(safeExternalUrl('  javascript:alert(1)  ')).toBeNull();
    expect(safeExternalUrl('\u0000javascript:alert(1)')).toBeNull();
  });

  test('surrounding whitespace on a good URL is trimmed, not rejected', () => {
    expect(safeExternalUrl('  https://example.com  ')).toBe('https://example.com/');
    expect(safeExternalUrl('\nhttps://example.com\t')).toBe('https://example.com/');
  });

  test('refuses protocol-relative URLs', () => {
    // It IS a web URL, and it is also what somebody writes when they mean a
    // path. Refused so an outbound link has to say where it goes.
    expect(safeExternalUrl('//evil.example')).toBeNull();
    expect(safeExternalUrl('//evil.example/path')).toBeNull();
  });

  test('refuses relative paths — those are not external links', () => {
    expect(safeExternalUrl('/events')).toBeNull();
    expect(safeExternalUrl('events')).toBeNull();
    expect(safeExternalUrl('../up')).toBeNull();
  });

  test('refuses malformed and empty input of every shape', () => {
    expect(safeExternalUrl('')).toBeNull();
    expect(safeExternalUrl('   ')).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl(0)).toBeNull();
    expect(safeExternalUrl(123)).toBeNull();
    expect(safeExternalUrl({})).toBeNull();
    expect(safeExternalUrl([])).toBeNull();
    expect(safeExternalUrl('http://')).toBeNull();
    expect(safeExternalUrl('https://')).toBeNull();
    expect(safeExternalUrl('not a url at all')).toBeNull();
    expect(safeExternalUrl(':::')).toBeNull();
  });

  test('refuses other non-web schemes', () => {
    expect(safeExternalUrl('ftp://example.com/f')).toBeNull();
    expect(safeExternalUrl('mailto:a@b.com')).toBeNull();
    expect(safeExternalUrl('tel:+123456')).toBeNull();
  });

  test('returns the reserialised URL, so what renders is what was checked', () => {
    // A parser and a renderer disagreeing about one string is the shape of
    // most URL bypasses, so the validated object is what comes back.
    expect(safeExternalUrl('https://EXAMPLE.com')).toBe('https://example.com/');
  });
});

describe('safeContactUrl', () => {
  test('allows contact schemes', () => {
    expect(safeContactUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    expect(safeContactUrl('tel:+201234567890')).toBe('tel:+201234567890');
    expect(safeContactUrl('sms:+201234567890')).toBe('sms:+201234567890');
  });

  test('still allows web URLs', () => {
    expect(safeContactUrl('https://example.com')).toBe('https://example.com/');
  });

  test('still refuses executable schemes', () => {
    expect(safeContactUrl('javascript:alert(1)')).toBeNull();
    expect(safeContactUrl('data:text/html,x')).toBeNull();
    expect(safeContactUrl('vbscript:x')).toBeNull();
    expect(safeContactUrl('')).toBeNull();
    expect(safeContactUrl(null)).toBeNull();
  });
});

describe('safeHref', () => {
  test('keeps same-origin paths', () => {
    expect(safeHref('/events')).toBe('/events');
    expect(safeHref('/e/some-slug?tier=2')).toBe('/e/some-slug?tier=2');
    expect(safeHref('/')).toBe('/');
  });

  test('keeps same-document fragments and queries', () => {
    expect(safeHref('#section')).toBe('#section');
    expect(safeHref('?filter=all')).toBe('?filter=all');
  });

  test('keeps absolute web URLs', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com/');
  });

  test('refuses protocol-relative, executable and bare-relative values', () => {
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    // A bare relative href resolves against the CURRENT page, so the same
    // string means a different destination on every route it renders on.
    expect(safeHref('events')).toBeNull();
  });

  test('falls back rather than dropping a CTA', () => {
    expect(safeHref('javascript:alert(1)', '/events')).toBe('/events');
    expect(safeHref('', '/events')).toBe('/events');
    expect(safeHref(null, '/events')).toBe('/events');
    expect(safeHref('//evil.example', '/events')).toBe('/events');
    // A good value is never replaced by the fallback.
    expect(safeHref('/why-us', '/events')).toBe('/why-us');
  });
});
