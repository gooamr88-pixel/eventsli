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
// Inline styles only: every mail client strips <style> blocks, and a ticket
// that arrives unstyled is one a guest cannot read at a dark venue door.

// The storefront's accent blue (globals.css `--es-accent`). Was emerald until
// the brand moved to blue on 2026-09-17.
const BRAND = '#2c62bd';
const shell = (heading, body) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0E1613">
  <h1 style="font-size:20px;margin:0 0 20px;color:${BRAND}">${heading}</h1>
  ${body}
  <p style="margin-top:32px;padding-top:16px;border-top:1px solid #E2E7E3;font-size:12px;color:#5E6D66">
    Eventsli
  </p>
</div>`;

const money = (cents, currency) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);

/**
 * The tickets themselves.
 *
 * The QR images come from OUR domain. They used to come from a public QR
 * generator, with the signed admission token in the query string — handing a
 * third party the credential that opens the door for every ticket we have ever
 * sold. See ticketController.qrImage.
 *
 * BACKEND_URL, not FRONTEND_URL: this is an API route, and it has to be
 * absolute or every mail client shows a broken image.
 */
async function sendTickets({ to, buyerName, event, tickets, order, organizerEmail, accessToken }) {
  const apiBase = (process.env.BACKEND_URL || '').replace(/\/+$/, '');
  const rows = tickets.map((t) => `
    <div style="border:1px solid #E2E7E3;border-radius:10px;padding:16px;margin-bottom:12px">
      <div style="font-weight:600;font-size:15px">${escapeHtml(event.title)}</div>
      <div style="color:#5E6D66;font-size:13px;margin:4px 0 12px">
        ${t.seat ? escapeHtml(t.seat) : ''}${t.table ? ` · Table ${escapeHtml(t.table)}` : ''}
      </div>
      <img
        src="${apiBase}/api/v1/public/qr/${encodeURIComponent(t.qr)}.png"
        alt="Entry code" width="180" height="180"
        style="display:block;border:0" />
    </div>`).join('');

  return send({
    to,
    replyTo: organizerEmail,
    subject: `Your tickets — ${event.title}`,
    html: shell('Your tickets', `
      <p>Hi ${escapeHtml(buyerName || 'there')}, here ${tickets.length === 1 ? 'is your ticket' : `are your ${tickets.length} tickets`}.</p>
      ${rows}
      <p style="font-size:13px;color:#5E6D66">
        Show ${tickets.length === 1 ? 'this code' : 'these codes'} at the door. Each one is scanned once.<br>
        Paid ${money(order.buyer_total_cents, order.currency)}.
      </p>
      ${accessToken ? `
      <p style="margin-top:24px;padding-top:16px;border-top:1px solid #E2E7E3">
        <a href="${process.env.FRONTEND_URL?.split(',')[0] || ''}/t/${encodeURIComponent(accessToken)}"
           style="color:${BRAND}">Open your tickets online</a>
        <br><span style="font-size:12px;color:#8A9791">
          Keep this email — it is how you get back to them.
        </span>
      </p>` : ''}`),
  });
}

/** BRD §18 — the invoice, and what happens if it is not paid. */
async function sendInvoiceIssued({ to, organizerName, invoice, event }) {
  return send({
    to,
    subject: `Commission invoice ${invoice.number} — ${event.title}`,
    html: shell('Commission due', `
      <p>Hi ${escapeHtml(organizerName || 'there')},</p>
      <p>
        Commission on the sales you recorded for <strong>${escapeHtml(event.title)}</strong>
        comes to <strong>${money(invoice.amount_cents, invoice.currency)}</strong>
        (${invoice.order_count} sale${invoice.order_count === 1 ? '' : 's'}).
      </p>
      <p>Invoice <strong>${invoice.number}</strong> is due
         <strong>${new Date(invoice.due_at).toLocaleString('en-CA')}</strong>.</p>
      <p style="background:#FEF3C7;border-left:3px solid #B45309;padding:12px;font-size:14px">
        If it is not settled by then, ticket scanning for this event is switched off
        until it is. Your account and your other events are not affected.
      </p>
      <p>Pay by bank transfer, then upload the receipt in your dashboard.</p>`),
  });
}

/** Sent when the gate has actually closed — a different message from a reminder. */
async function sendInvoiceOverdue({ to, organizerName, invoice, event }) {
  return send({
    to,
    subject: `Scanning disabled — ${event.title}`,
    html: shell('Scanning is switched off', `
      <p>Hi ${escapeHtml(organizerName || 'there')},</p>
      <p>
        Invoice <strong>${invoice.number}</strong> for
        <strong>${money(invoice.amount_cents, invoice.currency)}</strong> is past its due date,
        so ticket scanning for <strong>${escapeHtml(event.title)}</strong> is now disabled.
      </p>
      <p>Settle it and upload your receipt — scanning resumes as soon as we confirm the transfer.</p>`),
  });
}

async function sendInvoiceSettled({ to, organizerName, invoice, event }) {
  return send({
    to,
    subject: `Payment confirmed — ${event.title}`,
    html: shell('Payment confirmed', `
      <p>Hi ${escapeHtml(organizerName || 'there')},</p>
      <p>
        We have confirmed your transfer for invoice <strong>${invoice.number}</strong>
        (${money(invoice.amount_cents, invoice.currency)}).
        Scanning for <strong>${escapeHtml(event.title)}</strong> is active again.
      </p>`),
  });
}

/** BRD §16 — a rejection the organizer can act on. */
async function sendEventRejected({ to, organizerName, event, reason }) {
  return send({
    to,
    subject: `Changes needed — ${event.title}`,
    html: shell('Changes needed before publishing', `
      <p>Hi ${escapeHtml(organizerName || 'there')},</p>
      <p><strong>${escapeHtml(event.title)}</strong> was reviewed and needs a change:</p>
      <blockquote style="margin:16px 0;padding:12px 16px;background:#F4F6F4;border-left:3px solid ${BRAND}">
        ${escapeHtml(reason)}
      </blockquote>
      <p>Update it in your dashboard and submit it again.</p>`),
  });
}

async function sendEventApproved({ to, organizerName, event, url }) {
  return send({
    to,
    subject: `${event.title} is live`,
    html: shell('Your event is live', `
      <p>Hi ${escapeHtml(organizerName || 'there')},</p>
      <p><strong>${escapeHtml(event.title)}</strong> has been approved and is now on sale.</p>
      ${url ? `<p><a href="${url}" style="color:${BRAND}">${url}</a></p>` : ''}`),
  });
}

/** BRD §10 — both parties are told when a ticket changes hands. */
async function sendTicketTransferred({ to, event, direction, counterparty }) {
  const isSender = direction === 'sent';
  return send({
    to,
    subject: `Ticket ${isSender ? 'transferred' : 'received'} — ${event.title}`,
    html: shell(isSender ? 'Ticket transferred' : 'A ticket was sent to you', `
      <p>
        ${isSender
          ? `Your ticket for <strong>${escapeHtml(event.title)}</strong> was transferred to ${escapeHtml(counterparty || 'someone else')}.`
          : `You have been given a ticket for <strong>${escapeHtml(event.title)}</strong>.`}
      </p>
      <p style="font-size:13px;color:#5E6D66">
        A ticket can only be passed on once, so this one cannot be transferred again.
      </p>`),
  });
}

/**
 * Activating an account.
 *
 * The LINK is the main path — one tap from the inbox, and it signs them in. The
 * six digits stay underneath for someone who signed up on a laptop and opened
 * the email on a phone, where the link would sign in the wrong device.
 *
 * The code is still the subject's first word: a phone notification shows the
 * subject, and someone switching back from their mail app should not have to
 * open the message.
 */
async function sendVerificationCode({ to, name, code, minutes, link, linkHours }) {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const button = link ? `
      <p style="margin:28px 0">
        <a href="${escapeHtml(link)}"
           style="display:inline-block;padding:14px 28px;background:${BRAND};color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px">
          Activate my account
        </a>
      </p>
      <p style="font-size:13px;color:#5E6D66">
        The button works for ${Number(linkHours) || 48} hours. If it does not open, paste this into your browser:<br>
        <span style="word-break:break-all">${escapeHtml(link)}</span>
      </p>` : '';
  return send({
    to,
    subject: `${code} is your Eventsli code — or tap to activate`,
    html: shell('Activate your Eventsli account', `
      <p>Hi ${escapeHtml(name || 'there')},</p>
      <p>You are one step away. Activate your account to get started:</p>
      ${button}
      <p style="margin-top:28px">Or enter this code on the sign-up screen:</p>
      <p style="margin:12px 0 20px;font-size:28px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,Consolas,monospace;color:#0E1613">
        ${escapeHtml(spaced)}
      </p>
      <p style="font-size:13px;color:#5E6D66">
        The code expires in ${Number(minutes) || 10} minutes. If you did not create an Eventsli
        account, ignore this email — nothing happens unless you use it.
      </p>`),
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
    html: shell('An organizer wants to cancel an event', `
      <p><strong>${escapeHtml(organizerName || 'An organizer')}</strong> asked Eventsli to cancel
        <strong>${escapeHtml(event.title)}</strong>. Their reason:</p>
      <blockquote style="margin:16px 0;padding:12px 16px;background:#F4F6F4;border-left:3px solid ${BRAND}">
        ${escapeHtml(reason)}
      </blockquote>
      ${url ? `<p><a href="${escapeHtml(url)}" style="color:${BRAND}">Review the request</a></p>` : ''}`),
  });
}

/** The super admin's answer, told to the organizer who asked. */
async function sendCancellationDecided({ to, organizerName, event, approved, note }) {
  return send({
    to,
    subject: `${approved ? 'Cancelled' : 'Cancellation not approved'} — ${event.title}`,
    html: shell(approved ? 'Your event has been cancelled' : 'Your cancellation request was not approved', `
      <p>Hi ${escapeHtml(organizerName || 'there')},</p>
      <p>${approved
        ? `Eventsli approved your request. <strong>${escapeHtml(event.title)}</strong> is cancelled: ticket sales have stopped and the gate is closed.`
        : `Eventsli reviewed your request to cancel <strong>${escapeHtml(event.title)}</strong> and did not approve it. The event stays as it was.`}</p>
      ${note ? `<blockquote style="margin:16px 0;padding:12px 16px;background:#F4F6F4;border-left:3px solid ${BRAND}">${escapeHtml(note)}</blockquote>` : ''}`),
  });
}

/**
 * Added to an event's door team.
 *
 * Says exactly what they can do — scan this one event — and where to go, so
 * the email is the instructions rather than a notification to go and find some.
 */
async function sendDoorTeamAdded({ to, name, eventTitle, organizerName, startsAt, timezone, gateUrl }) {
  const when = startsAt
    ? new Date(startsAt).toLocaleString('en-CA', { dateStyle: 'full', timeStyle: 'short', timeZone: timezone || 'UTC' })
    : null;
  return send({
    to,
    subject: `You can scan tickets for ${eventTitle}`,
    html: shell('You are on the door team', `
      <p>Hi ${escapeHtml(name || 'there')},</p>
      <p>
        ${escapeHtml(organizerName || 'The organizer')} added you to the door team for
        <strong>${escapeHtml(eventTitle)}</strong>${when ? ` on ${escapeHtml(when)}` : ''}.
        You can scan tickets for this event with your own Eventsli account.
      </p>
      <p style="margin:24px 0">
        <a href="${gateUrl}" style="background:${BRAND};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">
          Open the scanner
        </a>
      </p>
      <p style="font-size:13px;color:#5E6D66">
        On the phone or tablet you will scan with, open the link, choose
        <strong>My account</strong> and pick this event. You can scan and undo a scan for this
        event only — nothing else changes about your account.
      </p>`),
  });
}

/**
 * Every value interpolated into an email is escaped.
 *
 * An event title is organizer-controlled text going into HTML that lands in
 * someone else's inbox. Mail clients are inconsistent about what they execute,
 * and the safe assumption is that some of them will.
 */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
