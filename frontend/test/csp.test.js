import { describe, test, expect } from 'vitest';
import { buildCsp, securityHeaders, GOOGLE } from '../config/csp.mjs';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The production policy, asserted.
 *
 * This is why the policy was moved out of next.config.mjs. In there it was
 * evaluated once at build time with `isDev` read from the ambient environment,
 * so a test could only ever observe the DEVELOPMENT policy — the permissive
 * one. The production policy, the only one that protects anybody, was the one
 * nothing could check.
 *
 * The specific promise being kept: the platform this replaces needed
 * `'unsafe-inline'` permanently, because its pages carried inline <script>
 * blocks — dashboard.html alone was 146KB of them — and it had `esm.sh` in
 * script-src because the seat map imported panzoom from a CDN at runtime,
 * inside the purchase path. Neither may come back.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const NONCE = 'ab12cd34-0000-4000-8000-000000000000';
const PROD = {
  isDev: false, apiOrigin: 'https://api.eventsli.com', supabaseHost: 'proj.supabase.co', nonce: NONCE,
};
const DEV = { isDev: true, apiOrigin: 'http://localhost:5000', supabaseHost: 'proj.supabase.co' };

/** The value of one directive, as a list of sources. */
function directive(csp, name) {
  const found = csp.split('; ').find((d) => d === name || d.startsWith(`${name} `));
  if (!found) return null;
  return found.slice(name.length).trim().split(/\s+/).filter(Boolean);
}

describe('the production CSP', () => {
  const csp = buildCsp(PROD);

  test('no `unsafe-inline` on scripts', () => {
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-inline'");
  });

  test('no `unsafe-eval` either', () => {
    expect(csp).not.toContain("'unsafe-eval'");
  });

  test('no CDN, and esm.sh by name', () => {
    // Named because it is the specific one that used to be in the purchase
    // path. A seat map that fetches its pan-zoom library from a third party at
    // runtime means that third party can replace the checkout.
    expect(csp).not.toContain('esm.sh');
    expect(csp).not.toContain('unpkg');
    expect(csp).not.toContain('jsdelivr');
    expect(csp).not.toContain('cdnjs');
  });

  /**
   * The regression this suite exists for, above all the others.
   *
   * `script-src 'self'` with no nonce does not weaken a Next.js app — it kills
   * it. The App Router streams React's payload inside inline <script> tags, and
   * a strict policy refuses every one: the server HTML renders, a crawler is
   * happy, Lighthouse gives it SEO 100, and nothing on the page works. It
   * shipped that way for eight phases because it only happens under
   * `next start`.
   */
  test('Next’s inline payload scripts are allowed, by nonce', () => {
    expect(directive(csp, 'script-src')).toContain(`'nonce-${NONCE}'`);
  });

  test('and a policy built without a nonce does not silently pretend to work', () => {
    // Belt and braces: if the nonce ever stops being threaded through from
    // proxy.ts, the header must not quietly become the broken-production one.
    const nonceless = buildCsp({ ...PROD, nonce: undefined });
    expect(nonceless).not.toContain('nonce-');
    expect(directive(nonceless, 'script-src')).toEqual(["'self'", GOOGLE]);
  });

  test('no `strict-dynamic`, and so no `unsafe-inline` smuggled in as a fallback', () => {
    // The usual strict-dynamic recipe restores older-browser compatibility with
    // `https:` and `'unsafe-inline'` — inert under CSP3, and the exact string
    // this project promised to keep out of the header.
    expect(csp).not.toContain('strict-dynamic');
    expect(directive(csp, 'script-src')).not.toContain('https:');
  });

  /**
   * WAS: "the only third party is Google Identity Services". The storefront's
   * introduction-video section added two more, and the assertion is kept as a
   * CLOSED SET rather than relaxed — a third party that appears here without
   * this list changing is the thing the test exists to catch.
   *
   * The second half is the part that matters more. Google needs script-src,
   * because its sign-in client is a script we run. YouTube and Vimeo must
   * NEVER appear there: they are framed, and a video host in script-src is a
   * standing permission to execute their code in our origin.
   */
  test('the third parties are exactly three, each only where it is needed', () => {
    const thirdParties = csp
      .split('; ')
      .flatMap((d) => d.split(/\s+/).slice(1))
      .filter((source) => source.startsWith('http') && !source.includes('api.eventsli.com')
        && !source.includes('supabase.co'));

    expect(new Set(thirdParties)).toEqual(new Set([
      GOOGLE,
      'https://www.youtube.com',
      'https://player.vimeo.com',
    ]));

    expect(directive(csp, 'script-src')).toContain(GOOGLE);
    expect(directive(csp, 'frame-src')).toContain(GOOGLE);

    for (const host of ['youtube.com', 'vimeo.com']) {
      expect(directive(csp, 'script-src').join(' ')).not.toContain(host);
      expect(directive(csp, 'connect-src').join(' ')).not.toContain(host);
      expect(directive(csp, 'frame-src').join(' ')).toContain(host);
    }
  });

  test('apis.google.com is gone', () => {
    // Vestigial: it served the OLD Google Sign-In library, which this codebase
    // never used. A host in script-src that nothing loads from is a standing
    // permission for an injection to fetch executable code.
    expect(csp).not.toContain('apis.google.com');
  });

  /**
   * `media-src` WAS `'none'`, asserted here with the note that nothing on this
   * site plays audio or video. That stopped being true when the storefront
   * gained its introduction-video section, and the assertion is now about the
   * thing that actually matters: the policy admits our own origin and our own
   * storage bucket, and no third party.
   */
  test('video plays from our own origin and our own bucket, and nowhere else', () => {
    const sources = directive(csp, 'media-src');
    expect(sources).toContain("'self'");
    expect(sources.every((s) => s === "'self'" || s.startsWith('https://'))).toBe(true);
    expect(sources).not.toContain('*');
    expect(csp).not.toContain("media-src 'none'");
  });

  /**
   * The two video hosts, and the reason this is asserted rather than trusted:
   * `backend/utils/landingSchema.js` accepts exactly YouTube and Vimeo for the
   * film's URL. A URL the schema saves and the policy blocks is the worst
   * outcome available — the section looks configured and is blank for
   * everybody, with the only evidence in a visitor's console.
   */
  test('the video hosts the CMS accepts are the video hosts the policy admits', () => {
    const sources = directive(csp, 'frame-src');
    expect(sources).toContain('https://www.youtube.com');
    expect(sources).toContain('https://player.vimeo.com');
  });

  test('nobody frames us', () => {
    // The clickjacking guard, and it is absolute — a checkout inside somebody
    // else's iframe is the whole attack.
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
  });

  test('the closed directives are closed', () => {
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
    expect(directive(csp, 'default-src')).toEqual(["'self'"]);
  });

  test('the gate’s service worker is allowed explicitly', () => {
    // It would be allowed by the script-src fallback anyway. Stated so that
    // tightening script-src later cannot silently break offline scanning at a
    // door — a tablet that will not open its own page, found by whoever is
    // holding it.
    expect(directive(csp, 'worker-src')).toEqual(["'self'"]);
    expect(directive(csp, 'manifest-src')).toEqual(["'self'"]);
  });

  test('styles keep `unsafe-inline`, and that is the argued exception', () => {
    // Next injects @font-face and critical CSS as inline <style> and the App
    // Router has no nonce plumbing. If this ever changes, this test should be
    // the thing that fails and gets deleted deliberately.
    expect(directive(csp, 'style-src')).toContain("'unsafe-inline'");
  });

  test('http subresources are upgraded rather than mixed', () => {
    expect(csp).toContain('upgrade-insecure-requests');
  });
});

describe('the development CSP', () => {
  const csp = buildCsp(DEV);

  test('allows what the dev overlay needs, and only in development', () => {
    expect(directive(csp, 'script-src')).toContain("'unsafe-inline'");
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
  });

  test('does not upgrade to https — everything is http://localhost', () => {
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});

describe('the other security headers', () => {
  const prod = Object.fromEntries(securityHeaders(PROD).map((h) => [h.key, h.value]));
  const dev = Object.fromEntries(securityHeaders(DEV).map((h) => [h.key, h.value]));

  test('the CSP is NOT among them', () => {
    // Two CSP headers are enforced as their intersection, so a nonce-free copy
    // declared statically would block the very scripts the nonce allows — and
    // the app would be broken again by a policy that looks stricter for it.
    // proxy.ts is the only issuer.
    expect(prod['Content-Security-Policy']).toBeUndefined();
  });

  test('the camera is allowed for us and for nobody else, and nothing else is', () => {
    // /gate asks for it at the point of use. Everything else is denied so a
    // compromised dependency cannot open a microphone on the checkout page.
    expect(prod['Permissions-Policy']).toBe(
      'camera=(self), microphone=(), geolocation=(), payment=()',
    );
  });

  test('nosniff and a referrer policy are present', () => {
    expect(prod['X-Content-Type-Options']).toBe('nosniff');
    expect(prod['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  test('HSTS in production only, and not preloaded', () => {
    expect(prod['Strict-Transport-Security']).toContain('max-age=63072000');
    expect(prod['Strict-Transport-Security']).toContain('includeSubDomains');
    // `preload` is a one-way door that takes months to undo. Left off until
    // somebody decides about every subdomain that will ever exist.
    expect(prod['Strict-Transport-Security']).not.toContain('preload');
    // On localhost it would make the dev site permanently https in the
    // developer's browser.
    expect(dev['Strict-Transport-Security']).toBeUndefined();
  });
});
