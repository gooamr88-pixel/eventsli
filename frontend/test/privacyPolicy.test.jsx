import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import PrivacyPage from '../src/app/privacy/page';
import { GOOGLE, VIDEO_FRAMES, MAP_FRAME } from '../config/csp.mjs';
import { CONTACT_EMAIL } from '../src/app/lib/siteRoutes';

/**
 * THE PRIVACY POLICY MUST NAME EVERY OUTSIDE PARTY THE SOFTWARE TALKS TO.
 *
 * The page promises "we share it only with the people and services listed
 * here". That promise breaks silently the day somebody adds a host to the CSP
 * or a provider to the backend and forgets this page — so both lists are read
 * from where they really live, and every party in them has to be named.
 */

const text = () => render(<PrivacyPage />).container.textContent;

/** Each external origin the browser may reach, and the name the page must use for it. */
const BROWSER_PARTIES = {
  'accounts.google.com': 'Google',
  'www.youtube.com': 'YouTube',
  'player.vimeo.com': 'Vimeo',
  'www.openstreetmap.org': 'OpenStreetMap',
};

describe('the privacy policy', () => {
  test('names every third party the browser is allowed to load from', () => {
    const hosts = [GOOGLE, ...VIDEO_FRAMES.split(/\s+/), MAP_FRAME].map((u) => new URL(u).host);
    const page = text();
    for (const host of hosts) {
      expect(BROWSER_PARTIES[host], `${host} is in the CSP but this test does not know who it is — add it here and to /privacy`).toBeTruthy();
      expect(page, `${host} is in the CSP but /privacy never names ${BROWSER_PARTIES[host]}`).toContain(BROWSER_PARTIES[host]);
    }
  });

  test('names every AI provider the backend can send organizer text to', () => {
    const config = fs.readFileSync(path.join(process.cwd(), '..', 'backend', 'services', 'ai', 'config.js'), 'utf8');
    const block = config.match(/const PROVIDERS = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
    expect(block, 'PROVIDERS not found in backend/services/ai/config.js').toBeTruthy();
    const providers = [...block[1].matchAll(/^ {2}([a-z]+): \{/gm)].map((m) => m[1]);
    expect(providers.length).toBeGreaterThan(0);
    const named = { gemini: 'Gemini', groq: 'Groq' };
    for (const p of providers) {
      expect(named[p], `${p} is a backend AI provider this test does not know — add it here and to /privacy`).toBeTruthy();
      expect(text()).toContain(named[p]);
    }
  });

  test('names the services that hold or send personal information', () => {
    const page = text();
    for (const name of ['Stripe', 'Brevo', 'Supabase']) expect(page).toContain(name);
  });

  test('says where information is kept, how to reach us, and when it changed', () => {
    const page = text();
    expect(page).toContain('United States (Amazon Web Services, us-west-1)');
    expect(page).toContain(CONTACT_EMAIL);
    expect(page).toMatch(/Last updated \d{1,2} [A-Z][a-z]+ \d{4}/);
    expect(page).toContain('16 or older');
  });

  test('discloses that the free AI tier may use what it is sent', () => {
    expect(text()).toMatch(/free tier[^.]*may use what it is sent to improve its products/);
  });
});
