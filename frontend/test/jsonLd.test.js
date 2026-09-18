import { describe, test, expect } from 'vitest';
import { jsonLdScript } from '../src/app/utils/jsonLd';

/**
 * Structured data, escaped for the inside of a <script> element.
 *
 * THE BUG THIS PINS is stored XSS on the most-visited page on the platform.
 * `JSON.stringify` escapes for JSON, and JSON has no opinion about `<` — so a
 * string containing `</script>` came through intact, and the HTML parser ended
 * the script block at it before any JavaScript was parsed. Everything after was
 * markup, in the platform's own origin.
 *
 * The values are an event's title, venue and description, typed by the
 * organizer. Admin review sits between a draft and publication, but a reviewer
 * reading a title for tone is not auditing it for markup.
 */

describe('it cannot break out of a script block', () => {
  test('a closing script tag in a title is neutralised', () => {
    const payload = "Summer Gala</script><script>alert(document.domain)</script>";
    const out = jsonLdScript({ name: payload });

    // The literal characters that end the block must not survive.
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });

  test('the escaping is transparent to a JSON parser', () => {
    // The whole point of escaping on the way OUT rather than stripping on the
    // way in: the organizer keeps their title and crawlers read it unchanged.
    const payload = 'A <b>bold</b> night & more </script>';
    expect(JSON.parse(jsonLdScript({ name: payload })).name).toBe(payload);
  });

  test('nested values are covered, not just the top level', () => {
    const out = jsonLdScript({
      '@type': 'Event',
      location: { '@type': 'Place', name: '</script><img src=x onerror=alert(1)>' },
      offers: [{ price: '10', seller: { name: '</script>' } }],
    });
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<');
  });

  test('ampersands are escaped too', () => {
    // Not strictly required to end a script block, but an unescaped `&` in an
    // attribute-ish context is the next thing somebody finds.
    const out = jsonLdScript({ name: 'Rock & Roll' });
    expect(out).toContain('\\u0026');
    expect(JSON.parse(out).name).toBe('Rock & Roll');
  });

  test('the JavaScript line terminators are escaped', () => {
    // U+2028 and U+2029 are legal inside a JSON string and are line breaks in
    // JavaScript source — a title with one produced a script that would not
    // parse at all. A broken page rather than a stolen session, same mechanism.
    const payload = 'line break here';
    const out = jsonLdScript({ name: payload });

    expect(out).not.toContain(' ');
    expect(out).not.toContain(' ');
    expect(JSON.parse(out).name).toBe(payload);
  });

  test('ordinary structured data is unchanged in meaning', () => {
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'An Evening on the Waterfront',
      startDate: '2026-12-14T19:00:00.000Z',
      offers: { '@type': 'Offer', price: 79, priceCurrency: 'CAD' },
    };
    expect(JSON.parse(jsonLdScript(data))).toEqual(data);
  });
});

describe('every emission site uses it', () => {
  test('no page stringifies straight into a ld+json script', async () => {
    // The fix is only as good as its adoption, and the next JSON-LD block
    // somebody adds is the one that will reach for JSON.stringify again.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.join(process.cwd(), 'src', 'app');

    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.jsx?$/.test(entry.name)) continue;
        const src = fs.readFileSync(full, 'utf8');
        if (!src.includes('ld+json')) continue;
        if (/__html:\s*JSON\.stringify/.test(src)) {
          offenders.push(path.relative(root, full).replace(/\\/g, '/'));
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });
});
