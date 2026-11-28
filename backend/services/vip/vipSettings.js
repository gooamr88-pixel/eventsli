/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP Services — settings (2026-11-28). One JSON document in platform_settings
 * under 'vip_services', cleaned here. Every default lives here too, so the
 * feature works before anyone has saved anything.
 *
 * The super admin sets: on/off, the WhatsApp number and email organizers are
 * shown, the reply-time promise, which services are offered (and their
 * words), and who is emailed about new requests and messages.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const E164 = /^\+[1-9][0-9]{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SERVICE_KEYS = ['full_setup', 'seating', 'marketing', 'door', 'hospitality', 'partners', 'other'];

const DEFAULT_SERVICES = [
  { key: 'full_setup', icon: 'sparkle', title: 'Full event setup', blurb: 'We build your event page, tickets and checkout, ready to sell.' },
  { key: 'seating', icon: 'map', title: 'Seat map design', blurb: 'Your venue drawn from its floor plan: tables, rows, sections and prices.' },
  { key: 'marketing', icon: 'trend', title: 'Marketing and launch', blurb: 'A launch plan, social posts, emails and texts that fill the room.' },
  { key: 'door', icon: 'scan', title: 'Door and check-in team', blurb: 'Trained staff with scanners at your doors on the night.' },
  { key: 'hospitality', icon: 'crown', title: 'VIP guest hospitality', blurb: 'Guest lists, VIP arrivals, table service and personal hosts.' },
  { key: 'partners', icon: 'handshake', title: 'Sponsors and vendors', blurb: 'We find, sign and look after sponsors and vendors for you.' },
  { key: 'other', icon: 'chat', title: 'Something else', blurb: 'Tell us what you have in mind and we will shape it with you.' },
];

const ICONS = new Set(['sparkle', 'map', 'trend', 'scan', 'crown', 'handshake', 'chat', 'star', 'users', 'mic', 'music', 'food', 'film', 'store', 'shield', 'ticket', 'image', 'bulb', 'target', 'briefcase']);

const DEFAULTS = Object.freeze({
  enabled: true,
  whatsappNumber: '+16196666620',
  email: 'info@eventsli.com',
  responseTime: 'We reply within a few hours, every day of the week.',
  services: DEFAULT_SERVICES.map((s) => ({ ...s, enabled: true })),
  notifyAdmins: true,
  notifyEmails: ['info@eventsli.com'],
});

const str = (v, max, fallback) => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || fallback;
};

function cleanNumber(v) {
  const s = typeof v === 'string' ? v.replace(/[\s().-]/g, '') : '';
  const e = s.startsWith('00') ? `+${s.slice(2)}` : s;
  return E164.test(e) ? e : DEFAULTS.whatsappNumber;
}

function cleanServices(input) {
  const given = new Map((Array.isArray(input) ? input : []).filter((s) => s && SERVICE_KEYS.includes(s.key)).map((s) => [s.key, s]));
  return DEFAULT_SERVICES.map((d) => {
    const s = given.get(d.key) || {};
    return {
      key: d.key,
      icon: ICONS.has(s.icon) ? s.icon : d.icon,
      title: str(s.title, 60, d.title),
      blurb: str(s.blurb, 200, d.blurb),
      enabled: s.enabled === undefined ? true : Boolean(s.enabled),
    };
  });
}

function clean(input) {
  const v = input && typeof input === 'object' ? input : {};
  const email = typeof v.email === 'string' && EMAIL.test(v.email.trim()) ? v.email.trim().toLowerCase() : DEFAULTS.email;
  const services = cleanServices(v.services);
  // At least one service is always offered: an empty form is a dead end.
  if (!services.some((s) => s.enabled)) services.find((s) => s.key === 'other').enabled = true;
  return {
    enabled: v.enabled === undefined ? DEFAULTS.enabled : Boolean(v.enabled),
    whatsappNumber: v.whatsappNumber === undefined ? DEFAULTS.whatsappNumber : cleanNumber(v.whatsappNumber),
    email,
    responseTime: typeof v.responseTime === 'string' ? v.responseTime.trim().slice(0, 160) : DEFAULTS.responseTime,
    services,
    notifyAdmins: v.notifyAdmins === undefined ? DEFAULTS.notifyAdmins : Boolean(v.notifyAdmins),
    notifyEmails: Array.isArray(v.notifyEmails)
      ? [...new Set(v.notifyEmails.map((e) => String(e || '').trim().toLowerCase()).filter((e) => EMAIL.test(e) && e.length <= 254))].slice(0, 10)
      : [...DEFAULTS.notifyEmails],
  };
}

/** What an organizer's page needs: no notification list. */
function publicView(s) {
  return {
    enabled: s.enabled,
    whatsappNumber: s.whatsappNumber,
    email: s.email,
    responseTime: s.responseTime,
    services: s.services.filter((x) => x.enabled).map(({ enabled, ...rest }) => rest),
  };
}

module.exports = { clean, publicView, DEFAULTS, SERVICE_KEYS };
