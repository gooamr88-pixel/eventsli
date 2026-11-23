/**
 * Sponsorship levels and their labels — a plain module, NOT `'use client'`.
 *
 * These lived in sponsorUi.jsx, which is a client module. The public
 * "Become a sponsor" page is a SERVER component and called `levelLabel()`
 * from there; Next refuses a server-side call into a client module, so every
 * event with a public sponsorship package crashed into the site-wide error
 * screen (React #441, 2026-11-23). sponsorUi re-exports both for its client
 * callers.
 */
export const LEVELS = Object.freeze([
  ['headline', 'Headline'],
  ['gold', 'Gold'],
  ['silver', 'Silver'],
  ['bronze', 'Bronze'],
  ['partner', 'Partner'],
]);

export const levelLabel = (level) => (LEVELS.find(([v]) => v === level) || [null, 'Partner'])[1];
