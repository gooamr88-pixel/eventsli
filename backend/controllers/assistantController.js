const { supabase } = require('../config/supabase');
const { sendOk } = require('../utils/responseEnvelope');
const { aiConfig } = require('../services/ai/config');
const { redact } = require('../services/ai/redact');
const { generateAssistantReply, basicReply } = require('../services/ai/assistant');
const { SELECT, shape, lowestTierPrices } = require('./discoveryController');
const { anyWordFilter } = require('../utils/search');
const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The homepage assistant (see services/ai/assistant.js for what it may say).
 *
 * PUBLIC, SO BOUNDED THREE WAYS:
 *   · per visitor — the route's limiter (publicRoutes.js);
 *   · per message — length and history caps in the route's validators;
 *   · per day — `AI_ASSISTANT_DAILY_CAP` AI answers across everyone. Past it,
 *     answers continue in basic mode, so a burst of traffic (or a bot) can
 *     never spend the organizers' free-tier provider capacity.
 *
 * The cap is counted in this process. With one backend process (pm2 fork
 * mode, as deployed) that is exact; with N it is N × the cap, which is still a
 * bound — the providers' own rate limits are the backstop either way.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const usage = { day: '', count: 0 };

function underCap(cap) {
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) Object.assign(usage, { day, count: 0 });
  return usage.count < cap;
}

/** Is the AI side of the assistant on? Off is a normal answer, not an error. */
function aiAvailable(cfg = aiConfig()) {
  return Boolean(cfg.enabled && cfg.assistant.enabled && underCap(cfg.assistant.cap));
}

// ─── GET /public/assistant ──────────────────────────────────────────────────
/** Lets the homepage decide between the AI chat and the plain contact link. */
function status(req, res) {
  return sendOk(res, { ai: aiAvailable() });
}

// ─── Grounding ─────────────────────────────────────────────────────────────
const STOP = new Set(['event', 'events', 'ticket', 'tickets', 'this', 'that', 'weekend', 'week', 'tonight', 'today', 'tomorrow',
  'find', 'show', 'near', 'want', 'looking', 'something', 'anything', 'what', 'when', 'where', 'which', 'there', 'some',
  'with', 'have', 'from', 'about', 'please', 'thanks', 'hello', 'going', 'happening', 'things', 'would', 'could', 'like',
  'your', 'need', 'help', 'good', 'best', 'cheap', 'free', 'next', 'month']);

/** Words worth searching the catalogue for, from the visitor's latest message. */
function keywordsOf(text) {
  return [...new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].filter((w) => !STOP.has(w)).slice(0, 6);
}

function priceText(e) {
  if (e.displayOnly) return 'listing only, no tickets sold here';
  if (e.fromPriceCents === null || e.fromPriceCents === undefined) return 'price on the event page';
  if (e.fromPriceCents === 0) return 'free tickets';
  return `from $${(e.fromPriceCents / 100).toFixed(e.fromPriceCents % 100 ? 2 : 0)} ${e.currency}`;
}

function whenText(e) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: e.timezone,
    }).format(new Date(e.startsAt));
  } catch {
    return e.startsAt;
  }
}

/**
 * The events the model may mention: ones matching the visitor's words first,
 * then the soonest upcoming, at most 16 — a short list it can actually read,
 * from the same published-only rule as every public listing.
 */
async function contextEvents(text) {
  const nowIso = new Date().toISOString();
  const base = () => supabase.from('events').select(SELECT).eq('status', 'published').gte('ends_at', nowIso);
  const words = keywordsOf(text);
  const [matched, soon] = await Promise.all([
    words.length ? base().or(anyWordFilter(words)).order('starts_at').limit(8) : Promise.resolve({ data: [] }),
    base().order('starts_at').limit(12),
  ]);
  if (soon.error) throw new Error(soon.error.message);

  const seen = new Set();
  const rows = [...(matched.data || []), ...(soon.data || [])].filter((e) => !seen.has(e.id) && seen.add(e.id)).slice(0, 16);
  const prices = await lowestTierPrices(rows.map((e) => e.id));
  return rows.map((e) => {
    const card = { ...shape(e), fromPriceCents: prices.get(e.id) ?? null };
    return { card, slug: card.slug, title: card.title, when: whenText(card), venue: card.venue, city: card.city, category: card.categoryLabel || card.category, price: priceText(card) };
  });
}

function todayIn(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: tz }).format(new Date());
  } catch {
    return new Date().toDateString();
  }
}

// ─── POST /public/assistant/messages ────────────────────────────────────────
async function reply(req, res, next) {
  try {
    const cfg = aiConfig();
    // Only the visitor's own words are redacted; the assistant's earlier
    // replies came from us. Bounded again here whatever the validators let by.
    const messages = req.body.messages.slice(-8).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      text: m.role === 'assistant' ? String(m.text).slice(0, 700) : redact(String(m.text).slice(0, 500)).text,
    }));
    const last = [...messages].reverse().find((m) => m.role === 'user')?.text || '';
    const events = await contextEvents(last);
    const today = todayIn(req.body.timezone || 'America/Toronto');

    let answer;
    let mode = 'basic';
    if (aiAvailable(cfg)) {
      usage.count += 1;   // counted on the attempt: a failing provider must not make the cap free
      try {
        answer = await generateAssistantReply({ messages, events, today, cfg });
        mode = 'ai';
        logger.info({ provider: answer.meta.provider, ms: answer.meta.latency_ms, events: answer.eventSlugs.length }, 'assistant answered');
      } catch (err) {
        logger.warn({ code: err.code }, 'assistant: AI unavailable, answering in basic mode');
      }
    }
    if (!answer) answer = basicReply({ text: last, events });

    const bySlug = new Map(events.map((e) => [e.slug, e.card]));
    return sendOk(res, {
      mode,
      reply: answer.reply,
      events: answer.eventSlugs.map((slug) => bySlug.get(slug)).filter(Boolean),
      link: answer.link ? { label: answer.link.label, href: answer.link.href } : null,
      suggestions: answer.suggestions,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { status, reply, keywordsOf, aiAvailable, _usage: usage };
