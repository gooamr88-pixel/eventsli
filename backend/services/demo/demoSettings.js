/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Book a demo" settings (owner, 2026-11-19): everything an admin controls.
 *
 * One JSON document in platform_settings under 'demo_booking'. `clean` is the
 * single gate: whatever is stored or posted passes through it, unknown keys
 * are dropped, every number is clamped and every list is bounded. Missing
 * keys take DEFAULTS, so the page works before anyone has saved a thing.
 *
 * Pure: no database, so the rules are tested directly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FIELD_MODES = ['required', 'optional', 'hidden'];
const QUESTION_TYPES = ['text', 'textarea', 'select'];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const weekdayHours = [['09:00', '17:00']];

const DEFAULTS = Object.freeze({
  enabled: true,
  title: 'Book a demo',
  intro: 'See Eventsli on your own event: seat maps, ticket types, check-in at the door and payouts, '
    + 'walked through live with our team in thirty minutes.',
  confirmationMessage: 'Thanks — your demo is booked. We have emailed the details and a link to change or cancel it.',
  durationMinutes: 30,
  intervalMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 12,
  maxDaysAhead: 30,
  timezone: 'America/Toronto',
  weeklyHours: {
    sun: [], mon: weekdayHours, tue: weekdayHours, wed: weekdayHours, thu: weekdayHours, fri: weekdayHours, sat: [],
  },
  blockedDates: [],
  capacity: 1,
  dailyLimit: 0,
  meetingLink: '',
  meetingNote: 'We will email you the video call link before the demo.',
  contactPhone: '',
  contactEmail: 'info@eventsli.com',
  fields: {
    phone: { mode: 'optional', label: 'Phone' },
    company: { mode: 'required', label: 'What is your event name or website?' },
    topic: { mode: 'optional', label: 'How can we help you?' },
    message: { mode: 'optional', label: 'Anything we should know before the call?' },
  },
  topics: [
    'Selling tickets for my event',
    'Seating maps and tables',
    'Check-in at the door',
    'Pricing and fees',
    'Something else',
  ],
  questions: [],
  notifyAdmins: true,
  notifyEmails: [],
  reminderHours: 24,
});

const LIMITS = Object.freeze({
  durationMinutes: [10, 180],
  intervalMinutes: [5, 180],
  bufferMinutes: [0, 120],
  minNoticeHours: [0, 24 * 30],
  maxDaysAhead: [1, 365],
  capacity: [1, 20],
  dailyLimit: [0, 100],
  reminderHours: [0, 168],
});

function text(value, fallback, max) {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, max);
}

function int(value, fallback, [min, max]) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function validZone(zone) {
  if (typeof zone !== 'string' || !zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

const minutes = (hhmm) => {
  const m = TIME.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** A day's windows: valid "HH:MM" pairs, start before end, sorted, no overlaps, at most 6. */
function cleanWindows(list) {
  if (!Array.isArray(list)) return [];
  const windows = list
    .filter((w) => Array.isArray(w) && w.length === 2 && minutes(w[0]) !== null && minutes(w[1]) !== null)
    .map(([a, b]) => [a, b])
    .filter(([a, b]) => minutes(a) < minutes(b))
    .sort((x, y) => minutes(x[0]) - minutes(y[0]));
  const merged = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && minutes(w[0]) <= minutes(last[1])) {
      if (minutes(w[1]) > minutes(last[1])) last[1] = w[1];
    } else {
      merged.push([...w]);
    }
  }
  return merged.slice(0, 6);
}

function cleanField(value, fallback) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    mode: FIELD_MODES.includes(v.mode) ? v.mode : fallback.mode,
    label: text(v.label, fallback.label, 120) || fallback.label,
  };
}

function cleanQuestions(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.slice(0, 10).map((q, i) => {
    if (!q || typeof q !== 'object') return null;
    const label = text(q.label, '', 160);
    if (!label) return null;
    let id = text(q.id, '', 40).replace(/[^a-z0-9_-]/gi, '') || `q${i + 1}`;
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    const type = QUESTION_TYPES.includes(q.type) ? q.type : 'text';
    const options = type === 'select'
      ? [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => text(o, '', 80)).filter(Boolean))].slice(0, 20)
      : [];
    if (type === 'select' && options.length === 0) return null;
    return { id, label, type, options, required: q.required === true };
  }).filter(Boolean);
}

/** Anything → a complete, safe settings object. */
function clean(input) {
  const s = input && typeof input === 'object' ? input : {};
  const weekly = s.weeklyHours && typeof s.weeklyHours === 'object' ? s.weeklyHours : DEFAULTS.weeklyHours;
  const fields = s.fields && typeof s.fields === 'object' ? s.fields : {};
  const durationMinutes = int(s.durationMinutes, DEFAULTS.durationMinutes, LIMITS.durationMinutes);
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULTS.enabled,
    title: text(s.title, DEFAULTS.title, 80) || DEFAULTS.title,
    intro: text(s.intro, DEFAULTS.intro, 1000),
    confirmationMessage: text(s.confirmationMessage, DEFAULTS.confirmationMessage, 600) || DEFAULTS.confirmationMessage,
    durationMinutes,
    intervalMinutes: int(s.intervalMinutes, durationMinutes, LIMITS.intervalMinutes),
    bufferMinutes: int(s.bufferMinutes, DEFAULTS.bufferMinutes, LIMITS.bufferMinutes),
    minNoticeHours: int(s.minNoticeHours, DEFAULTS.minNoticeHours, LIMITS.minNoticeHours),
    maxDaysAhead: int(s.maxDaysAhead, DEFAULTS.maxDaysAhead, LIMITS.maxDaysAhead),
    timezone: validZone(s.timezone) ? s.timezone : DEFAULTS.timezone,
    weeklyHours: Object.fromEntries(DAYS.map((d) => [d, cleanWindows(weekly[d])])),
    blockedDates: [...new Set((Array.isArray(s.blockedDates) ? s.blockedDates : [])
      .filter((d) => typeof d === 'string' && DATE.test(d)))].sort().slice(0, 366),
    capacity: int(s.capacity, DEFAULTS.capacity, LIMITS.capacity),
    dailyLimit: int(s.dailyLimit, DEFAULTS.dailyLimit, LIMITS.dailyLimit),
    meetingLink: /^https:\/\//i.test(text(s.meetingLink, '', 1000)) ? text(s.meetingLink, '', 1000) : '',
    meetingNote: text(s.meetingNote, DEFAULTS.meetingNote, 300),
    contactPhone: text(s.contactPhone, DEFAULTS.contactPhone, 30),
    contactEmail: EMAIL.test(text(s.contactEmail, '', 254)) ? text(s.contactEmail, '', 254) : DEFAULTS.contactEmail,
    fields: Object.fromEntries(Object.entries(DEFAULTS.fields).map(([k, f]) => [k, cleanField(fields[k], f)])),
    topics: [...new Set((Array.isArray(s.topics) ? s.topics : DEFAULTS.topics)
      .map((t) => text(t, '', 80)).filter(Boolean))].slice(0, 15),
    questions: cleanQuestions(s.questions),
    notifyAdmins: typeof s.notifyAdmins === 'boolean' ? s.notifyAdmins : DEFAULTS.notifyAdmins,
    notifyEmails: [...new Set((Array.isArray(s.notifyEmails) ? s.notifyEmails : [])
      .map((e) => text(e, '', 254).toLowerCase()).filter((e) => EMAIL.test(e)))].slice(0, 10),
    reminderHours: int(s.reminderHours, DEFAULTS.reminderHours, LIMITS.reminderHours),
  };
}

/** What the public page may know: no notify list, no reminder timing. */
function publicView(s) {
  return {
    enabled: s.enabled,
    title: s.title,
    intro: s.intro,
    confirmationMessage: s.confirmationMessage,
    durationMinutes: s.durationMinutes,
    maxDaysAhead: s.maxDaysAhead,
    timezone: s.timezone,
    meetingNote: s.meetingNote,
    contactPhone: s.contactPhone,
    contactEmail: s.contactEmail,
    fields: s.fields,
    topics: s.topics,
    questions: s.questions,
  };
}

module.exports = { DEFAULTS, LIMITS, DAYS, clean, publicView, cleanWindows, minutes };
