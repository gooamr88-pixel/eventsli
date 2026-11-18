const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const media = require('./mediaService');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ORGANIZER PUBLIC PROFILES and MESSAGES FROM TICKET HOLDERS (owner,
 * 2026-11-18; migration 20261127090000).
 *
 *   /o/<slug>       an organizer's page: who they are, how to reach them (only
 *                   what they chose to publish), and all their events
 *   ticket pages    "Message the organizer" — emailed to them with the buyer
 *                   as reply-to; their account email is never shown
 *
 * THE NEW COLUMNS ARE READ ONLY HERE. Every other query in the API keeps its
 * old column list, and `linkFor` swallows an error, so a server whose database
 * has not had the migration yet loses these features and nothing else — the
 * add-ons rollout (2026-11-18) showed what happens otherwise.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PUBLIC_COLUMNS = 'id, display_name, description, country, created_at, is_banned, slug, logo_path, public_email, public_phone, website_url, social_links';

/** The networks an organizer can link, and how a bare handle becomes a link. */
const SOCIAL = Object.freeze({
  instagram: { label: 'Instagram', host: 'instagram.com', url: (h) => `https://instagram.com/${h}` },
  facebook: { label: 'Facebook', host: 'facebook.com', url: (h) => `https://facebook.com/${h}` },
  x: { label: 'X', host: 'x.com', alt: 'twitter.com', url: (h) => `https://x.com/${h}` },
  tiktok: { label: 'TikTok', host: 'tiktok.com', url: (h) => `https://tiktok.com/@${h}` },
  youtube: { label: 'YouTube', host: 'youtube.com', alt: 'youtu.be', url: (h) => `https://youtube.com/@${h}` },
  linkedin: { label: 'LinkedIn', host: 'linkedin.com', url: (h) => `https://linkedin.com/company/${h}` },
});

/** Addresses that would read as Eventsli's own pages. */
const RESERVED_SLUGS = new Set(['admin', 'eventsli', 'support', 'help', 'api', 'organizer', 'organizers', 'new', 'edit', 'settings', 'login']);

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

const isMissingSchema = (error) => /column .* does not exist|relation .* does not exist|schema cache|PGRST20[045]|42703|42P01/i
  .test(`${error?.code || ''} ${error?.message || ''}`);

// ─── Normalising what an organizer types ────────────────────────────────────

/**
 * A handle or a full link, to a link on that network — or a refusal. A link to
 * some other site in the Instagram box is refused rather than published as
 * "Instagram", which is how a profile page becomes a phishing page.
 */
function socialLink(key, raw) {
  const net = SOCIAL[key];
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    let u;
    try { u = new URL(value); } catch { throw fail('VALIDATION_ERROR', `That ${net.label} link is not a valid address.`); }
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const ok = [net.host, net.alt].filter(Boolean).some((h) => host === h || host.endsWith(`.${h}`));
    if (!ok || u.protocol !== 'https:') throw fail('VALIDATION_ERROR', `Use a link on ${net.host} for ${net.label}.`);
    return u.toString().slice(0, 300);
  }
  const handle = value.replace(/^@/, '');
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(handle)) throw fail('VALIDATION_ERROR', `That ${net.label} handle has characters a handle cannot have.`);
  return net.url(handle);
}

function websiteUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let u;
  try { u = new URL(withScheme); } catch { throw fail('VALIDATION_ERROR', 'That website is not a valid address.'); }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw fail('VALIDATION_ERROR', 'That website is not a valid address.');
  return u.toString().slice(0, 300);
}

function publicEmail(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw fail('VALIDATION_ERROR', 'That contact email does not look right.');
  return value;
}

function publicPhone(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (!/^\+?[0-9 ().-]{5,40}$/.test(value)) throw fail('VALIDATION_ERROR', 'Use digits, spaces and + ( ) - only for the phone number.');
  return value;
}

function slugOf(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,59}$/.test(value)) {
    throw fail('VALIDATION_ERROR', 'Use 2–60 lowercase letters, numbers and single hyphens for your page address.');
  }
  if (RESERVED_SLUGS.has(value)) throw fail('VALIDATION_ERROR', 'That page address is reserved. Choose another.');
  return value;
}

// ─── Shapes ─────────────────────────────────────────────────────────────────

const logoUrlOf = (path) => (path ? media.publicUrl(path) : null);

function socialList(links) {
  return Object.keys(SOCIAL)
    .filter((k) => typeof links?.[k] === 'string' && links[k])
    .map((k) => ({ key: k, label: SOCIAL[k].label, url: links[k] }));
}

/** What anyone may see. Only fields the organizer filled in; never their account email. */
function publicShape(row) {
  return {
    slug: row.slug,
    name: row.display_name,
    description: row.description || null,
    country: row.country,
    logoUrl: logoUrlOf(row.logo_path),
    memberSince: row.created_at,
    contact: {
      email: row.public_email || null,
      phone: row.public_phone || null,
      website: row.website_url || null,
    },
    social: socialList(row.social_links),
  };
}

/** What the organizer edits: the same, with the raw logo path. */
function ownerShape(row) {
  return { ...publicShape(row), logoPath: row.logo_path || null, socialLinks: row.social_links || {} };
}

// ─── Reading ────────────────────────────────────────────────────────────────

/**
 * An organizer's public page by its address, with their published events:
 * what is coming (soonest first) and what has been (latest first, a dozen).
 * Null for an unknown address or a banned organizer — the same answer, so the
 * page cannot be used to learn who was banned.
 */
async function bySlug(slug) {
  const value = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{2,60}$/.test(value)) return null;
  const { data: org, error } = await supabase.from('organizers').select(PUBLIC_COLUMNS).eq('slug', value).maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return null;
    throw new Error(error.message);
  }
  if (!org || org.is_banned) return null;

  const discovery = require('../controllers/discoveryController');
  const { data: rows, error: evError } = await supabase.from('events').select(discovery.SELECT)
    .eq('organizer_id', org.id).eq('status', 'published')
    .order('starts_at', { ascending: true }).limit(200);
  if (evError) throw new Error(evError.message);

  const all = rows || [];
  const [prices, avail] = await Promise.all([discovery.lowestTierPrices(all), discovery.listingAvailability(all)]);
  const events = all.map((e) => ({ ...discovery.shape(e), fromPriceCents: prices.get(e.id) ?? null, availability: avail.get(e.id) ?? null }));
  const upcoming = events.filter((e) => !e.isPast);
  const past = events.filter((e) => e.isPast).reverse();

  return {
    organizer: publicShape(org),
    stats: { upcoming: upcoming.length, past: past.length },
    upcoming,
    past: past.slice(0, 12),
  };
}

/**
 * Name, address and logo for a link to the profile — from an event page or a
 * ticket. Never throws: no link is better than a broken ticket page.
 */
async function linkFor(organizerId) {
  if (!organizerId) return null;
  try {
    const { data, error } = await supabase.from('organizers')
      .select('display_name, slug, logo_path, public_email, public_phone, website_url, social_links, is_banned')
      .eq('id', organizerId).maybeSingle();
    if (error || !data || data.is_banned || !data.slug) return null;
    return {
      name: data.display_name,
      slug: data.slug,
      logoUrl: logoUrlOf(data.logo_path),
      contact: { email: data.public_email || null, phone: data.public_phone || null, website: data.website_url || null },
      social: socialList(data.social_links),
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'organizer link lookup failed');
    return null;
  }
}

// ─── The organizer's own editor ─────────────────────────────────────────────

async function ownRow(userId) {
  const { data, error } = await supabase.from('organizers').select(PUBLIC_COLUMNS).eq('owner_user_id', userId).maybeSingle();
  if (error) {
    if (isMissingSchema(error)) throw fail('FEATURE_DISABLED', 'Public profiles are not switched on yet on this server.');
    throw new Error(error.message);
  }
  if (!data) throw fail('NOT_FOUND', 'Create your organizer profile first.');
  return data;
}

async function getForOwner(userId) {
  return ownerShape(await ownRow(userId));
}

async function updateForOwner(userId, body = {}) {
  const current = await ownRow(userId);
  const patch = {};
  if (body.slug !== undefined) patch.slug = slugOf(body.slug);
  if (body.publicEmail !== undefined) patch.public_email = publicEmail(body.publicEmail);
  if (body.publicPhone !== undefined) patch.public_phone = publicPhone(body.publicPhone);
  if (body.website !== undefined) patch.website_url = websiteUrl(body.website);
  if (body.social !== undefined) {
    if (!body.social || typeof body.social !== 'object' || Array.isArray(body.social)) throw fail('VALIDATION_ERROR', 'Social links must be a list of networks.');
    const next = { ...(current.social_links || {}) };
    for (const [key, raw] of Object.entries(body.social)) {
      if (!SOCIAL[key]) throw fail('VALIDATION_ERROR', `Unknown network "${key}".`);
      const link = socialLink(key, raw);
      if (link) next[key] = link; else delete next[key];
    }
    patch.social_links = next;
  }
  if (Object.keys(patch).length === 0) throw fail('VALIDATION_ERROR', 'Nothing to update.');
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from('organizers').update(patch).eq('id', current.id).select(PUBLIC_COLUMNS).single();
  if (error) {
    if (error.code === '23505') throw fail('CONFLICT', 'That page address is taken. Choose another.');
    throw new Error(error.message);
  }
  return ownerShape(data);
}

async function signLogo(userId, contentType) {
  const row = await ownRow(userId);
  return media.signOrganizerLogo({ organizerId: row.id, contentType });
}

async function setLogo(userId, path) {
  const row = await ownRow(userId);
  let logoPath = null;
  if (path) {
    const attached = await media.attachOrganizerLogo({ organizerId: row.id, path, previousPath: row.logo_path });
    logoPath = attached.path;
  } else if (row.logo_path) {
    await media.remove(row.logo_path);
  }
  const { data, error } = await supabase.from('organizers')
    .update({ logo_path: logoPath, updated_at: new Date().toISOString() })
    .eq('id', row.id).select(PUBLIC_COLUMNS).single();
  if (error) throw new Error(error.message);
  return ownerShape(data);
}

// ─── Messages from ticket holders ───────────────────────────────────────────

/** Per order: enough to ask and follow up, not enough to flood an inbox. */
const LIMITS = Object.freeze({ perHour: 3, perDay: 8 });

/**
 * A ticket holder's message to the organizer of the event on their order.
 * The order token (checked by the caller) is the proof they hold a ticket.
 * Recorded first, then emailed with the buyer as reply-to.
 */
async function messageFromOrder({ orderId, senderName, body }) {
  const text = String(body || '').replace(/\r\n?/g, '\n').trim();
  if (text.length < 2) throw fail('VALIDATION_ERROR', 'Write your message first.');
  if (text.length > 2000) throw fail('VALIDATION_ERROR', 'Keep your message under 2000 characters.');
  const name = senderName ? String(senderName).trim().slice(0, 120) || null : null;

  const { data: order, error } = await supabase.from('orders')
    .select('id, guest_email, guest_name, events ( id, title, slug, organizer_id ), profiles!orders_user_id_fkey ( email )')
    .eq('id', orderId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!order || !order.events) throw fail('NOT_FOUND', 'That order does not exist.');
  const from = order.guest_email || order.profiles?.email;
  if (!from) throw fail('CONFLICT', 'This order has no email address to reply to.');

  const now = Date.now();
  const { data: recent, error: countError } = await supabase.from('organizer_messages')
    .select('created_at').eq('order_id', order.id)
    .gte('created_at', new Date(now - 864e5).toISOString());
  if (countError) {
    if (isMissingSchema(countError)) throw fail('FEATURE_DISABLED', 'Messaging the organizer is not switched on yet. Please try again later.');
    throw new Error(countError.message);
  }
  const lastHour = (recent || []).filter((r) => new Date(r.created_at).getTime() > now - 36e5).length;
  if (lastHour >= LIMITS.perHour || (recent || []).length >= LIMITS.perDay) {
    throw fail('RATE_LIMITED', 'You have sent several messages already. The organizer will reply by email — please give them a little time.');
  }

  const { data: org, error: orgError } = await supabase.from('organizers')
    .select('id, display_name, profiles!organizers_owner_user_id_fkey ( email )')
    .eq('id', order.events.organizer_id).maybeSingle();
  if (orgError) throw new Error(orgError.message);
  const to = org?.profiles?.email;
  if (!to) throw fail('CONFLICT', 'The organizer cannot be reached here right now.');

  const { data: saved, error: insertError } = await supabase.from('organizer_messages').insert({
    organizer_id: org.id, event_id: order.events.id, order_id: order.id,
    sender_email: from, sender_name: name || order.guest_name || null, body: text,
  }).select('id').single();
  if (insertError) throw new Error(insertError.message);

  const result = await require('./emailService').sendOrganizerMessage({
    to,
    organizerName: org.display_name,
    event: { title: order.events.title },
    senderName: name || order.guest_name || null,
    senderEmail: from,
    body: text,
    orderRef: order.id.slice(0, 8).toUpperCase(),
  });
  const delivered = result?.sent !== false;
  if (delivered) await supabase.from('organizer_messages').update({ delivered: true }).eq('id', saved.id);
  return { sent: delivered, organizer: org.display_name };
}

module.exports = {
  SOCIAL, LIMITS, RESERVED_SLUGS,
  socialLink, websiteUrl, publicEmail, publicPhone, slugOf, publicShape,
  bySlug, linkFor, getForOwner, updateForOwner, signLogo, setLogo, messageFromOrder,
};
