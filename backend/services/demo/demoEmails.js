const T = require('../emailTemplates');
const { send } = require('../emailService');
const { googleCalendarUrl } = require('./demoCalendar');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The "Book a demo" emails (2026-11-19). Best-effort like every email here:
 * `send` never throws, and a booking stands whether or not its email landed.
 *
 * Times are written in the BOOKER's zone (the one they picked on the page),
 * with the host's beside it when the two differ, so nobody has to convert.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const esc = T.escapeHtml;

function when(booking, settings) {
  const zone = booking.bookerTimezone || settings.timezone;
  const mine = T.whenText(booking.startsAt, zone);
  const host = zone !== settings.timezone ? T.whenText(booking.startsAt, settings.timezone) : null;
  return { mine, host };
}

function detailsFacts(booking, settings) {
  const w = when(booking, settings);
  return T.facts([
    ['When', w.mine],
    ...(w.host ? [['Our time', w.host]] : []),
    ['Length', `${settings.durationMinutes} minutes`],
    ['Where', booking.meetingLink ? 'Video call (link below)' : null],
  ]);
}

function meetingBlock(booking, settings) {
  if (booking.meetingLink) {
    return `${T.p(`Join the call here: <a href="${esc(booking.meetingLink)}">${esc(booking.meetingLink)}</a>`)}`;
  }
  return settings.meetingNote ? T.note('info', esc(settings.meetingNote)) : '';
}

function calendarLinks(booking, settings, icsUrl) {
  const title = `${settings.title} with Eventsli`;
  const google = googleCalendarUrl({
    start: booking.startsAt, end: booking.endsAt, title,
    details: booking.meetingLink ? `Join: ${booking.meetingLink}` : settings.meetingNote,
    location: booking.meetingLink || undefined,
  });
  const links = [`<a href="${esc(google)}">Google Calendar</a>`];
  if (icsUrl) links.push(`<a href="${esc(icsUrl)}">Apple, Outlook and others (.ics)</a>`);
  return T.p(`Add it to your calendar: ${links.join(' · ')}`);
}

async function sendConfirmed({ booking, settings, manageUrl, icsUrl }) {
  const w = when(booking, settings);
  return send({
    to: booking.email,
    replyTo: settings.contactEmail || undefined,
    subject: `Your Eventsli demo is booked — ${w.mine}`,
    html: T.layout({
      title: 'Your demo is booked',
      preheader: `${settings.durationMinutes} minutes with the Eventsli team, ${w.mine}.`,
      reason: 'You are receiving this email because you booked a demo on eventsli.com.',
      body: `
        ${T.p(`Hi ${esc(booking.name)},`)}
        ${T.p(esc(settings.confirmationMessage))}
        ${detailsFacts(booking, settings)}
        ${meetingBlock(booking, settings)}
        ${calendarLinks(booking, settings, icsUrl)}
        ${manageUrl ? T.button(manageUrl, 'Change or cancel') : ''}`,
    }),
  });
}

async function sendRescheduled({ booking, settings, manageUrl, icsUrl, previousStartsAt, byAdmin = false }) {
  const w = when(booking, settings);
  const before = previousStartsAt ? T.whenText(previousStartsAt, booking.bookerTimezone || settings.timezone) : null;
  return send({
    to: booking.email,
    replyTo: settings.contactEmail || undefined,
    subject: `Your Eventsli demo has moved — ${w.mine}`,
    html: T.layout({
      title: 'Your demo has a new time',
      preheader: `Now ${w.mine}.`,
      reason: 'You are receiving this email because you booked a demo on eventsli.com.',
      body: `
        ${T.p(`Hi ${esc(booking.name)},`)}
        ${T.p(byAdmin
          ? 'Our team has moved your demo to a new time. If it does not suit you, pick another one with the button below.'
          : 'Your demo is moved to the new time below.')}
        ${before ? T.p(`It was ${esc(before)}.`) : ''}
        ${detailsFacts(booking, settings)}
        ${meetingBlock(booking, settings)}
        ${calendarLinks(booking, settings, icsUrl)}
        ${manageUrl ? T.button(manageUrl, 'Change or cancel') : ''}`,
    }),
  });
}

async function sendUpdated({ booking, settings, manageUrl }) {
  const w = when(booking, settings);
  return send({
    to: booking.email,
    replyTo: settings.contactEmail || undefined,
    subject: `Your Eventsli demo — the call link`,
    html: T.layout({
      title: 'Your demo details',
      preheader: `For your demo ${w.mine}.`,
      reason: 'You are receiving this email because you booked a demo on eventsli.com.',
      body: `
        ${T.p(`Hi ${esc(booking.name)}, here are the details for your demo.`)}
        ${detailsFacts(booking, settings)}
        ${meetingBlock(booking, settings)}
        ${manageUrl ? T.button(manageUrl, 'View your booking') : ''}`,
    }),
  });
}

async function sendCancelled({ booking, settings, byAdmin, reason, bookUrl }) {
  const w = when(booking, settings);
  return send({
    to: booking.email,
    replyTo: settings.contactEmail || undefined,
    subject: `Your Eventsli demo is cancelled`,
    html: T.layout({
      title: 'Your demo is cancelled',
      preheader: `The demo for ${w.mine} is cancelled.`,
      reason: 'You are receiving this email because you booked a demo on eventsli.com.',
      body: `
        ${T.p(`Hi ${esc(booking.name)},`)}
        ${T.p(byAdmin
          ? `We had to cancel your demo for <strong>${esc(w.mine)}</strong>. We are sorry for the change.`
          : `Your demo for <strong>${esc(w.mine)}</strong> is cancelled, as you asked.`)}
        ${reason ? T.quote(esc(reason)) : ''}
        ${bookUrl ? T.p('Whenever it suits you, pick another time:') : ''}
        ${bookUrl ? T.button(bookUrl, 'Book a new time') : ''}`,
    }),
  });
}

async function sendReminder({ booking, settings, manageUrl }) {
  const w = when(booking, settings);
  return send({
    to: booking.email,
    replyTo: settings.contactEmail || undefined,
    subject: `Reminder: your Eventsli demo — ${w.mine}`,
    html: T.layout({
      title: 'See you soon',
      preheader: `Your demo is ${w.mine}.`,
      reason: 'You are receiving this reminder because you booked a demo on eventsli.com.',
      body: `
        ${T.p(`Hi ${esc(booking.name)}, a reminder that your demo with the Eventsli team is coming up.`)}
        ${detailsFacts(booking, settings)}
        ${meetingBlock(booking, settings)}
        ${manageUrl ? T.button(manageUrl, 'Change or cancel') : ''}`,
    }),
  });
}

/** One email per admin about a booking: new, moved or cancelled by the booker. */
async function sendToAdmins({ to, kind, booking, settings, adminUrl, previousStartsAt, reason }) {
  const host = T.whenText(booking.startsAt, settings.timezone);
  const heading = { new: 'New demo booked', moved: 'A demo was moved', cancelled: 'A demo was cancelled' }[kind];
  const answers = (booking.answers || []).map((a) => [a.label, a.answer]);
  const html = T.layout({
    title: heading,
    preheader: `${booking.name}, ${host}.`,
    reason: 'You are receiving this because you are an Eventsli admin or on the demo notification list.',
    body: `
      ${T.p(kind === 'cancelled'
        ? `<strong>${esc(booking.name)}</strong> cancelled their demo.`
        : `<strong>${esc(booking.name)}</strong> ${kind === 'moved' ? 'moved their demo to a new time' : 'booked a demo'}.`)}
      ${T.facts([
        ['When (our time)', host],
        ...(previousStartsAt ? [['Was', T.whenText(previousStartsAt, settings.timezone)]] : []),
        ['Name', booking.name],
        ['Email', booking.email],
        ['Phone', booking.phone],
        ['Event or website', booking.company],
        ['Topic', booking.topic],
        ...answers,
        ['Their time zone', booking.bookerTimezone],
      ])}
      ${booking.message ? T.quote(esc(booking.message)) : ''}
      ${reason ? T.quote(esc(reason)) : ''}
      ${adminUrl ? T.button(adminUrl, 'Open in the console') : ''}`,
  });
  return Promise.all(to.map((address) => send({
    to: address,
    replyTo: booking.email,
    subject: `${heading}: ${booking.name} — ${host}`,
    html,
  })));
}

module.exports = {
  sendConfirmed, sendRescheduled, sendUpdated, sendCancelled, sendReminder, sendToAdmins,
};
