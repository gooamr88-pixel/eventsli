#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Does Eventsli AI actually work on THIS machine, with THESE keys?
 *
 *   cd backend && node scripts/probe-ai.js            # every provider with a key
 *   cd backend && node scripts/probe-ai.js groq       # just one
 *
 * Calls each configured provider ONCE, separately (no fallback), with a fixed
 * sample description, runs the answer through the same validator the API
 * uses, and prints what came back: the model, how long it took, the tokens,
 * and the facts the validator kept. Run it before every deploy that touches
 * AI and on the VPS itself — that is the only place the IPv4 path and an
 * IP-restricted key can be proven together (I-010, I-019).
 *
 * Touches no database and spends no organizer's allowance. Prints no key: a
 * key is reported only as present or absent. On the free tiers (D-019) the
 * sample text is sent to the provider like any other request — it is
 * invented, and contains nothing personal.
 * ─────────────────────────────────────────────────────────────────────────────
 */
require('dotenv').config();

const { aiConfig, PROVIDERS } = require('../services/ai/config');
const { CALLERS } = require('../services/ai/providers');
const { buildRequest } = require('../services/ai/eventDraftPrompt');
const { validateDraft } = require('../services/ai/eventDraftValidate');

const SAMPLE = 'Comedy night at The Rex, 194 Queen St W, Toronto, on the first Friday of next month from 8pm until 10:30pm. '
  + '300 tickets, general admission $25, students $15. Doors 7:30, first act at 8.';
const CATEGORIES = [{ slug: 'comedy', label: 'Comedy' }, { slug: 'music', label: 'Music' }, { slug: 'other', label: 'Everything else' }];

async function probe(name) {
  const started = Date.now();
  const request = buildRequest({
    text: SAMPLE, listingType: 'ticketed', country: 'CA', currency: 'CAD', timezone: 'America/Toronto', categories: CATEGORIES,
  });
  try {
    const answer = await CALLERS[name]({ ...request, timeoutMs: 20_000 });
    const { draft, dropped } = validateDraft(answer.json, {
      text: SAMPLE, listingType: 'ticketed', timezone: 'America/Toronto', categories: CATEGORIES.map((c) => c.slug), now: new Date(),
    });
    console.log(`  ✓ ${name}  ${answer.model}  ${Date.now() - started} ms  tokens in/out ${answer.usage.input ?? '?'}/${answer.usage.output ?? '?'}`);
    console.log(`    title     ${draft.title}`);
    console.log(`    category  ${draft.category}`);
    console.log(`    starts    ${draft.startsAt.at || `— (${draft.startsAt.note || 'missing'})`}`);
    console.log(`    venue     ${draft.venueName.value || '—'} · ${draft.city.value || '—'}`);
    console.log(`    tiers     ${draft.tiers.map((t) => `${t.name} ${t.priceCents === null ? 'no price' : `$${t.priceCents / 100}`}`).join(', ') || 'none'}`);
    console.log(`    dropped   ${dropped} unverifiable fact(s)`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}  ${err.code || 'ERROR'}  ${Date.now() - started} ms — ${err.message}`);
    if (err.code === 'AI_AUTH') console.log('    The key was refused. Check it, and on the VPS check any IP restriction on it.');
    if (err.code === 'AI_REQUEST_REJECTED') console.log('    The request was refused: usually a retired model id (AI_*_MODEL) or a schema the API no longer accepts.');
    if (err.code === 'AI_RATE_LIMITED') console.log('    Rate limited. On a free tier this can be a per-minute limit; wait a minute and run again.');
    return false;
  }
}

(async () => {
  const cfg = aiConfig();
  console.log(`AI_ENABLED: ${/^(1|true|yes|on)$/i.test(process.env.AI_ENABLED || '') ? 'yes' : 'NO — the API will not offer AI until it is set'}`);
  for (const [name, p] of Object.entries(PROVIDERS)) {
    console.log(`  ${name}: key ${p.key() ? 'present' : 'ABSENT'}, model ${p.model()}`);
  }
  const only = process.argv[2];
  const names = (only ? [only] : Object.keys(PROVIDERS)).filter((n) => PROVIDERS[n]?.key());
  if (names.length === 0) {
    console.log('No provider has a key. Set AI_GEMINI_API_KEY and/or AI_GROQ_API_KEY in backend/.env.');
    process.exit(1);
  }
  console.log(`Order the API will use: ${cfg.order.join(' → ') || 'none'}`);
  const results = [];
  for (const name of names) results.push(await probe(name));
  process.exit(results.every(Boolean) ? 0 : 1);
})();
