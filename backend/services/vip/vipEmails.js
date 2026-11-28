const T = require('../emailTemplates');
const { send } = require('../emailService');
const { STATUS, BUDGETS, displayPhone, waLink } = require('./vipText');
const { manageUrl } = require('./vipLinks');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP Services emails (2026-11-28). Best effort like every email here: `send`
 * never throws, and a request stands whether or not its email landed.
 *
 * Every email to an organizer carries the WhatsApp button (click-to-chat
 * with the reference typed in) beside the dashboard link: email is the
 * fallback channel, not a second conversation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const esc = T.escapeHtml;
const REASON = 'You are receiving this email because you asked the Eventsli team for VIP Services.';

// A visitor has no dashboard: their private link instead (vipLinks.js).
const requestUrl = (r) => (r.source === 'visitor' ? manageUrl(r.id) : `${T.siteUrl()}/organizer/vip/${r.id}`);
const consoleUrl = (r) => `${T.siteUrl()}/admin/vip/${r.id}`;

function chatButton(settings, r) {
  const link = waLink(settings.whatsappNumber, `Hi Eventsli, about my VIP request ${r.reference}:`);
  return link ? T.p(`Or message us on WhatsApp at <a href="${esc(link)}">${esc(displayPhone(settings.whatsappNumber))}</a> and quote <strong>${esc(r.reference)}</strong>.`) : '';
}

function summary(r, serviceTitles, eventLabel) {
  return T.facts([
    ['Reference', r.reference],
    ['Services', serviceTitles.join(', ')],
    ['Event', eventLabel],
    ['Date', r.eventDate],
    ['Guests', r.guestCount ? String(r.guestCount) : null],
    ['Budget', r.budget ? BUDGETS[r.budget] : null],
  ]);
}

async function sendReceived({ request: r, settings, serviceTitles, eventLabel }) {
  return send({
    to: r.contactEmail,
    replyTo: settings.email,
    subject: `We have your VIP request ${r.reference}`,
    html: T.layout({
      title: 'Your VIP request is in',
      preheader: `${r.reference} — ${settings.responseTime || 'we will be in touch shortly.'}`,
      reason: REASON,
      body: `
        ${T.p(`Hi ${esc(r.contactName)},`)}
        ${T.p(`Thank you. The Eventsli team has your request. ${esc(settings.responseTime || '')}`)}
        ${summary(r, serviceTitles, eventLabel)}
        ${T.button(requestUrl(r), 'Open your request')}
        ${chatButton(settings, r)}`,
    }),
  });
}

/** The team wrote, and WhatsApp could not carry it (or they prefer email). */
async function sendTeamMessage({ request: r, settings, text, author }) {
  return send({
    to: r.contactEmail,
    replyTo: settings.email,
    subject: `New message about your VIP request ${r.reference}`,
    html: T.layout({
      title: 'A message from the Eventsli team',
      preheader: String(text).slice(0, 120),
      reason: REASON,
      body: `
        ${T.p(`Hi ${esc(r.contactName)}, ${author ? `${esc(author)} from the Eventsli team` : 'the Eventsli team'} wrote about <strong>${esc(r.reference)}</strong>:`)}
        ${T.quote(esc(text))}
        ${T.button(requestUrl(r), r.source === 'visitor' ? 'Open your request' : 'Reply in your dashboard')}
        ${chatButton(settings, r)}`,
    }),
  });
}

async function sendStatus({ request: r, settings, note }) {
  const s = STATUS[r.status] || STATUS.new;
  return send({
    to: r.contactEmail,
    replyTo: settings.email,
    subject: `VIP request ${r.reference}: ${s.label}`,
    html: T.layout({
      title: s.label,
      preheader: s.notice,
      reason: REASON,
      body: `
        ${T.p(`Hi ${esc(r.contactName)},`)}
        ${T.p(esc(s.notice))}
        ${note ? T.quote(esc(note)) : ''}
        ${T.button(requestUrl(r), 'Open your request')}
        ${chatButton(settings, r)}`,
    }),
  });
}

/** To the team: a new request, or the organizer wrote on the dashboard. */
async function sendToTeam({ to, kind, request: r, serviceTitles = [], eventLabel = null, text = null, organization = null }) {
  if (!to.length) return [];
  const heading = kind === 'new' ? 'New VIP request' : kind === 'cancelled' ? 'A VIP request was cancelled' : 'New message on a VIP request';
  const html = T.layout({
    title: heading,
    preheader: `${r.reference} — ${r.contactName}${organization ? `, ${organization}` : ''}`,
    reason: 'You are receiving this because you are an Eventsli admin or on the VIP Services notification list.',
    body: `
      ${T.p(kind === 'new'
        ? `<strong>${esc(r.contactName)}</strong>${organization ? ` (${esc(organization)})` : ''} asked for VIP Services.`
        : kind === 'cancelled'
          ? `<strong>${esc(r.contactName)}</strong> cancelled <strong>${esc(r.reference)}</strong>.`
          : `<strong>${esc(r.contactName)}</strong> wrote on <strong>${esc(r.reference)}</strong>:`)}
      ${text ? T.quote(esc(text)) : ''}
      ${kind === 'new' ? summary(r, serviceTitles, eventLabel) : ''}
      ${kind === 'new' ? T.facts([
        ['Email', r.contactEmail],
        ['WhatsApp', r.whatsappNumber ? displayPhone(r.whatsappNumber) : 'Not given'],
        ['WhatsApp messages', r.whatsappOptIn ? 'Agreed' : 'Not agreed'],
        ['Prefers', r.preferredChannel === 'email' ? 'Email' : 'WhatsApp'],
      ]) : ''}
      ${kind === 'new' && r.details ? T.quote(esc(r.details)) : ''}
      ${T.button(consoleUrl(r), 'Open in the console')}
      ${r.whatsappNumber ? T.p(`<a href="${esc(waLink(r.whatsappNumber))}">Open their WhatsApp chat</a>`) : ''}`,
  });
  return Promise.all(to.map((address) => send({
    to: address,
    replyTo: r.contactEmail,
    subject: `${heading}: ${r.reference} — ${r.contactName}`,
    html,
  })));
}

module.exports = { sendReceived, sendTeamMessage, sendStatus, sendToTeam };
