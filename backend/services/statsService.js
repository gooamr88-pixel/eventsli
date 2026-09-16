const { supabase } = require('../config/supabase');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The numbers on the homepage, counted rather than written.
 *
 * The brief for the storefront said "no fake hardcoded statistics", and the
 * reference design it came with showed "10K+ Events Created · 2M+ Happy Guests
 * · 150+ Cities Worldwide". This platform has one published event. Those three
 * figures are not a placeholder to fill in later — they are the thing that,
 * once typed into a component, nobody ever goes back and corrects.
 *
 * So there is no field anywhere in the CMS for a number. `landingSchema.stats`
 * lets an admin choose WHICH measures appear and what to CALL them; the values
 * come from here, and here they come from `count`.
 *
 * WHAT EACH ONE ACTUALLY MEANS, because a label on a homepage is a claim:
 *
 *   events      Events that reached the public. `published` and `completed`,
 *               not `draft` — a number that counts drafts is a number that
 *               counts an organizer's half-finished idea as an event.
 *   organizers  Organizer profiles that are not banned.
 *   guests      TICKETS ISSUED, not accounts. Most buyers here never create an
 *               account (guest checkout is a first-class path), so a count of
 *               `profiles` would under-report the audience by most of it.
 *   cities      Distinct cities across published events.
 *   visits      Page views in the last 30 days, from `site_visits`.
 *
 * Small numbers are the point, not a problem to hide. A storefront that says
 * "1 event" on its first day is telling the truth, and the frontend is built to
 * render a one-digit figure without it looking broken.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Five minutes. The page itself caches for sixty seconds, so this mostly
 *  spares the database the repeat when several pages render at once. */
const TTL_MS = 5 * 60 * 1000;

let cache = null;
let inFlight = null;

/** A count with no rows fetched — `head: true` sends no body back. */
async function countOf(table, apply = (q) => q) {
  const { count, error } = await apply(
    supabase.from(table).select('id', { count: 'exact', head: true }),
  );
  if (error) throw new Error(error.message);
  return count || 0;
}

/**
 * Distinct cities, counted in the API rather than in SQL.
 *
 * PostgREST has no `count(distinct)`, and the alternatives are a database view
 * or an RPC for a number that changes when an organizer creates an event. At
 * this size the column is cheaper to read than either is to maintain; the
 * limit is the guard that keeps that true if it stops being small.
 */
async function cityCount() {
  const { data, error } = await supabase
    .from('events')
    .select('city')
    .eq('status', 'published')
    .not('city', 'is', null)
    .limit(5000);

  if (error) throw new Error(error.message);
  const seen = new Set();
  for (const row of data || []) {
    const city = String(row.city || '').trim().toLowerCase();
    if (city) seen.add(city);
  }
  return seen.size;
}

/** Views over the trailing 30 days, summed. */
async function visitCount() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('site_visits')
    .select('views')
    .gte('day', since);

  if (error) throw new Error(error.message);
  return (data || []).reduce((sum, row) => sum + Number(row.views || 0), 0);
}

async function compute() {
  /**
   * Each measure resolves independently and a failure becomes null rather than
   * a rejection. This runs on the homepage: one slow count must not take the
   * whole page down, and a missing number renders as a hidden tile while the
   * rest of the strip stands.
   */
  const [events, organizers, guests, cities, visits] = await Promise.all([
    countOf('events', (q) => q.in('status', ['published', 'completed'])).catch(() => null),
    countOf('organizers', (q) => q.eq('is_banned', false)).catch(() => null),
    countOf('tickets').catch(() => null),
    cityCount().catch(() => null),
    visitCount().catch(() => null),
  ]);

  return { events, organizers, guests, cities, visits };
}

/**
 * The five figures, cached.
 *
 * Never throws. A homepage that 500s because a statistic was slow is a worse
 * outcome than a homepage with no statistics, and the strip is built to render
 * nothing at all when every value is null.
 */
async function platformStats() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  inFlight = inFlight || compute()
    .then((value) => { cache = { value, at: Date.now() }; return value; })
    .catch(() => ({ events: null, organizers: null, guests: null, cities: null, visits: null }))
    .finally(() => { inFlight = null; });

  return inFlight;
}

function invalidate() { cache = null; }

module.exports = { platformStats, invalidate };
