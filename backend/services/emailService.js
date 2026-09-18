const logger = require('../utils/logger');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Outgoing email, via Brevo.
 *
 * Everything here is BEST-EFFORT and never throws into a caller. A ticket that
 * was issued, a payment that was taken, an invoice that was settled — none of
 * those may be rolled back because an email provider had a bad minute. The
 * failure is logged loudly and the transaction stands.
 *
 * That is a deliberate trade with a real cost: a buyer can hold a paid ticket
 * they were never sent. The mitigation is that the ticket is always retrievable
 * from the success page and the account, so email is a convenience rather than
 * the only delivery channel. It is not a queue with retries — when volume
 * justifies one, `send` is the single place to put it behind.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const API = 'https://api.brevo.com/v3/smtp/email';

const configured = () => !!process.env.BREVO_API_KEY;

/**
 * @returns {Promise<{sent: boolean, reason?: string}>} — never rejects.
 */
async function send({ to, subject, html, replyTo }) {
  if (!configured()) {
    // Loud in development, where the usual reason is an unset key and the usual
    // symptom is silence.
    logger.warn({ to, subject }, 'email not sent: BREVO_API_KEY is not set');
    return { sent: false, reason: 'not_configured' };
  }
  if (!to) return { sent: false, reason: 'no_recipient' };

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: {
          email: process.env.BREVO_FROM_EMAIL,
          name: process.env.BREVO_FROM_NAME || 'Eventsli',
        },
        to: [{ email: to }],
        // Organizer events reply to the ORGANIZER, not to us. BRD §09 puts
        // refunds and event questions between them and the buyer; a reply that
        // lands in our inbox is one we have to forward and cannot answer.
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error({ to, subject, status: res.status, body: body.slice(0, 300) },
        'email rejected by Brevo');
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    logger.error({ err: err.message, to, subject }, 'email failed');
    return { sent: false, reason: 'network' };
  }
}

// ─── Templates ─────────────────────────────────────────────────────────────
/**
 * Every message is built from `emailTemplates` — one masthead, one footer, one
 * set of blocks. That file argues the email-HTML constraints at length; what
 * matters here is that no template writes its own markup any more, so the
 * identity cannot drift one email at a time.
 *
 * THREE THINGS EVERY MESSAGE NOW CARRIES that none of them did:
 *   · the logo and the name, so the sender is recognisable before it is read;
 *   · the EVENT — its date, its venue, its organizer — wherever the message is
 *     about one, because "Cruise Meeting" alone is not enough to act on;
 *   · a preheader, so the inbox preview line says something useful instead of
 *     scraping "Hi there".
 */
const T = require('./emailTemplates');

const { escapeHtml, money } = T;

/**
 * THE TICKETS — the most important email the platform sends.
 *
 * The seat used to be interpolated straight from `ticketService.shape()`,
 * where it is an OBJECT — so every buyer with an assigned seat was sent a
 * ticket reading "[object Object]". `T.seatLabel` is the fix and has a test.
 *
 * The QR images come from OUR domain, never a public QR generator: the token
 * in that URL is the credential that opens the door.
 */
async function sendTickets({ to, buyerName, event, tickets, order, organizerEmail, accessToken }) {
  const site = T.siteUrl();
  const one = tickets.length === 1;
  const when = T.whenText(event.starts_at ?? event.startsAt, event.timezone, { withZone: false });

  return send({
    to,
    replyTo: organizerEmail,
    subject: `Your ticket${one ? '' : 's'} — ${event.title}`,
    html: T.layout({
      title: one ? 'Your ticket' : `Your ${tickets.length} tickets`,
      // The date in the preview line, because that is what somebody scanning
      // an inbox a month later is looking for.
      preheader: when ? `${event.title} · ${when}` : event.title,
      reason: 'You are receiving this because you booked tickets on Eventsli. Keep it — it is how you get back to them.',
      body: `
        ${T.p(`Hi ${escapeHtml(buyerName || 'there')}, here ${one ? 'is your ticket' : `are your ${tickets.length} tickets`}.`)}
        ${T.eventCard(event)}
        ${tickets.map((t, i) => T.ticketCard(t, { index: i, total: tickets.length })).join('')}
        ${T.note('info', `
          <strong>At the door:</strong> show ${one ? 'this code' : 'these codes'} on your phone.
          Each one is scanned once. Turn your screen brightness up — it is read by a camera.`)}
        ${T.facts([
    ['Paid', money(order.buyer_total_cents, order.currency)],
    [one ? 'Ticket' : 'Tickets', String(tickets.length)],
  ])}
        ${accessToken && site ? `
          ${T.p('Lost this email? Your tickets are always here:')}
          ${T.button(`${site}/t/${encodeURIComponent(accessToken)}`, 'Open my tickets')}
        ` : ''}
        ${organizerEmail ? T.p('Questions about the event itself? Reply to this email — it reaches the organizer.', { small: true, color: T.MUTED }) : ''}`,
    }),
  });
}

/** BRD §18 — the invoice, and what happens if it is not paid. */
async function sendInvoiceIssued({ to, organizerName, invoice, event }) {
  const site = T.siteUrl();
  return send({
    to,
    subject: `Commission invoice ${invoice.number} — ${event.title}`,
    html: T.layout({
      title: 'Commission due',
      preheader: `${money(invoice.amount_cents, invoice.currency)} due ${T.whenText(invoice.due_at, null, { withZone: false }) || 'soon'}`,
      reason: 'You are receiving this because you have an organizer account on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.p(`Commission on the sales you recorded for this event is now due.`)}
        ${T.eventCard(event)}
        ${T.facts([
    ['Invoice', invoice.number],
    ['Sales recorded', `${invoice.order_count} sale${invoice.order_count === 1 ? '' : 's'}`],
    ['Amount', money(invoice.amount_cents, invoice.currency)],
    ['Due', T.whenText(invoice.due_at, null, { withZone: false })],
  ])}
        ${T.note('warning', `
          If it is not settled by the due date, <strong>ticket scanning for this event is switched
          off</strong> until it is. Your account and your other events are not affected.`)}
        ${T.p('Pay by bank transfer, then upload the receipt in your dashboard.')}
        ${site ? T.button(`${site}/organizer/payouts`, 'Upload my receipt') : ''}`,
    }),
  });
}

/** Sent when the gate has actually closed — a different message from a reminder. */
async function sendInvoiceOverdue({ to, organizerName, invoice, event }) {
  const site = T.siteUrl();
  return send({
    to,
    subject: `Scanning disabled — ${event.title}`,
    html: T.layout({
      title: 'Scanning is switched off',
      preheader: `Invoice ${invoice.number} is past due. Settle it to resume scanning.`,
      reason: 'You are receiving this because you have an organizer account on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.note('danger', `
          Invoice <strong>${escapeHtml(invoice.number)}</strong> for
          <strong>${escapeHtml(money(invoice.amount_cents, invoice.currency))}</strong> is past its
          due date, so ticket scanning for this event is <strong>now disabled</strong>.`)}
        ${T.eventCard(event)}
        ${T.p('Settle it and upload your receipt — scanning resumes as soon as we confirm the transfer.')}
        ${site ? T.button(`${site}/organizer/payouts`, 'Upload my receipt') : ''}`,
    }),
  });
}

async function sendInvoiceSettled({ to, organizerName, invoice, event }) {
  return send({
    to,
    subject: `Payment confirmed — ${event.title}`,
    html: T.layout({
      title: 'Payment confirmed',
      preheader: `Scanning for ${event.title} is active again.`,
      reason: 'You are receiving this because you have an organizer account on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.p(`We have confirmed your transfer. <strong>Scanning for this event is active again.</strong>`)}
        ${T.eventCard(event)}
        ${T.facts([
    ['Invoice', invoice.number],
    ['Amount', money(invoice.amount_cents, invoice.currency)],
    ['Status', 'Settled'],
  ])}`,
    }),
  });
}

/** BRD §16 — a rejection the organizer can act on. */
async function sendEventRejected({ to, organizerName, event, reason }) {
  const site = T.siteUrl();
  return send({
    to,
    subject: `Changes needed — ${event.title}`,
    html: T.layout({
      title: 'Changes needed before publishing',
      preheader: 'One change and it can go back for review.',
      reason: 'You are receiving this because you submitted an event for review on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.p('Your event was reviewed and needs a change before it can go on sale:')}
        ${T.quote(reason)}
        ${T.eventCard(event)}
        ${T.p('Update it in your dashboard and submit it again — reviews are usually answered within a day.')}
        ${site && event.id ? T.button(`${site}/organizer/events/${event.id}`, 'Open my event') : ''}`,
    }),
  });
}

async function sendEventApproved({ to, organizerName, event, url }) {
  return send({
    to,
    subject: `${event.title} is live`,
    html: T.layout({
      title: 'Your event is live',
      preheader: `${event.title} has been approved and is now on sale.`,
      reason: 'You are receiving this because you submitted an event for review on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.p('Your event has been approved and is now on sale. Here is what people will see:')}
        ${T.eventCard(event)}
        ${url ? T.button(url, 'View my event page') : ''}
        ${T.p('Share that link anywhere — the QR codes and social cards for it are in Share &amp; QR in your dashboard.', { small: true, color: T.MUTED })}`,
    }),
  });
}

/** BRD §10 — both parties are told when a ticket changes hands. */
async function sendTicketTransferred({ to, event, direction, counterparty }) {
  const isSender = direction === 'sent';
  const site = T.siteUrl();
  return send({
    to,
    subject: `Ticket ${isSender ? 'transferred' : 'received'} — ${event.title}`,
    html: T.layout({
      title: isSender ? 'Ticket transferred' : 'A ticket was sent to you',
      preheader: isSender
        ? `It now belongs to ${counterparty || 'someone else'} and no longer works for you.`
        : `You have a ticket for ${event.title}.`,
      reason: 'You are receiving this because a ticket linked to your email address changed hands.',
      body: `
        ${T.p(isSender
    ? `Your ticket was transferred to <strong>${escapeHtml(counterparty || 'someone else')}</strong>. It no longer admits you.`
    : 'You have been given a ticket. It is yours now and is in your account.')}
        ${T.eventCard(event)}
        ${!isSender && site ? T.button(`${site}/account/tickets`, 'Open my tickets') : ''}
        ${T.note('info', 'A ticket can only be passed on once, so this one cannot be transferred again.')}`,
    }),
  });
}

/**
 * Activating an account.
 *
 * The LINK is the main path — one tap from the inbox, and it signs them in.
 * The six digits stay underneath for somebody who signed up on a laptop and
 * opened the email on a phone, where the link would sign in the wrong device.
 *
 * The code is still the subject's first word: a phone notification shows the
 * subject, and somebody switching back from their mail app should not have to
 * open the message.
 */
async function sendVerificationCode({ to, name, code, minutes, link, linkHours }) {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  return send({
    to,
    subject: `${code} is your Eventsli code — or tap to activate`,
    html: T.layout({
      title: 'Activate your Eventsli account',
      preheader: `Your code is ${spaced}. It expires in ${Number(minutes) || 10} minutes.`,
      reason: 'You are receiving this because someone used this address to sign up for Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(name || 'there')},`)}
        ${T.p('You are one step away. Activate your account to get started:')}
        ${link ? T.button(link, 'Activate my account') : ''}
        ${link ? T.p(`The button works for ${Number(linkHours) || 48} hours. If it does not open, paste this into your browser:<br><span style="word-break:break-all;color:${T.MUTED}">${escapeHtml(link)}</span>`, { small: true, color: T.MUTED }) : ''}
        ${T.p('Or enter this code on the sign-up screen:')}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 18px">
          <tr><td align="center" style="padding:16px;background-color:${T.SUNKEN};border:1px solid ${T.LINE};border-radius:12px">
            <span style="font-family:${T.MONO};font-size:30px;font-weight:700;letter-spacing:8px;color:${T.INK}">${escapeHtml(spaced)}</span>
          </td></tr>
        </table>
        ${T.p(`The code expires in ${Number(minutes) || 10} minutes. If you did not create an Eventsli account, ignore this email — nothing happens unless you use it.`, { small: true, color: T.MUTED })}`,
    }),
  });
}

/**
 * An organizer asked for an event to be cancelled (BRD §17). Sent to every
 * super admin, because the decision is theirs; the console is the record.
 */
async function sendCancellationRequested({ to, organizerName, event, reason, url }) {
  return send({
    to,
    subject: `Cancellation requested — ${event.title}`,
    html: T.layout({
      title: 'An organizer wants to cancel an event',
      preheader: `${organizerName || 'An organizer'} asked to cancel ${event.title}.`,
      reason: 'You are receiving this because you are an Eventsli administrator.',
      body: `
        ${T.p(`<strong>${escapeHtml(organizerName || 'An organizer')}</strong> asked Eventsli to cancel this event. Their reason:`)}
        ${T.quote(reason)}
        ${T.eventCard(event)}
        ${url ? T.button(url, 'Review the request') : ''}`,
    }),
  });
}

/** The super admin's answer, told to the organizer who asked. */
async function sendCancellationDecided({ to, organizerName, event, approved, note: decisionNote }) {
  return send({
    to,
    subject: `${approved ? 'Cancelled' : 'Cancellation not approved'} — ${event.title}`,
    html: T.layout({
      title: approved ? 'Your event has been cancelled' : 'Your cancellation request was not approved',
      preheader: approved
        ? 'Sales have stopped and the gate is closed.'
        : 'The event stays as it was.',
      reason: 'You are receiving this because you asked Eventsli to cancel one of your events.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${approved
    ? T.note('danger', 'Eventsli approved your request. <strong>Ticket sales have stopped and the gate is closed.</strong> Tickets already sold are kept as a record for the people who bought them.')
    : T.p('Eventsli reviewed your request and did not approve it. The event stays exactly as it was.')}
        ${T.eventCard(event)}
        ${decisionNote ? T.quote(decisionNote) : ''}`,
    }),
  });
}

/**
 * Added to an event's door team.
 *
 * Says exactly what they can do — scan this one event — and where to go, so
 * the email is the instructions rather than a notification to go and find some.
 */
async function sendDoorTeamAdded({ to, name, eventTitle, organizerName, startsAt, timezone, gateUrl }) {
  return send({
    to,
    subject: `You can scan tickets for ${eventTitle}`,
    html: T.layout({
      title: 'You are on the door team',
      preheader: `${organizerName || 'The organizer'} added you to the door team for ${eventTitle}.`,
      reason: 'You are receiving this because an organizer added your email address to an event’s door team.',
      body: `
        ${T.p(`Hi ${escapeHtml(name || 'there')},`)}
        ${T.p(`<strong>${escapeHtml(organizerName || 'The organizer')}</strong> added you to the door team. You can scan tickets for this event with your own Eventsli account.`)}
        ${T.eventCard({ title: eventTitle, startsAt, timezone, organizerName })}
        ${T.button(gateUrl, 'Open the scanner')}
        ${T.note('info', `
          On the phone or tablet you will scan with, open the link, choose <strong>My account</strong>
          and pick this event. You can scan and undo a scan <strong>for this event only</strong> —
          nothing else about your account changes.`)}`,
    }),
  });
}

module.exports = {
  configured,
  send,
  escapeHtml,
  sendTickets,
  sendInvoiceIssued,
  sendInvoiceOverdue,
  sendInvoiceSettled,
  sendEventRejected,
  sendEventApproved,
  sendTicketTransferred,
  sendVerificationCode,
  sendCancellationRequested,
  sendCancellationDecided,
  sendDoorTeamAdded,
};
