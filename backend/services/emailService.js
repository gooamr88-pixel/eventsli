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
 * What a log line may say about a message.
 *
 * The verification email's SUBJECT begins with its six-digit code, and these
 * lines used to log `{ to, subject }` whenever Brevo was unset or refused a
 * send — so anyone reading the logs held an address and a working code for it
 * (TECH-AUDIT-LOG T-021). The address is masked and every run of digits in the
 * subject is blanked; enough is left to tell which message failed.
 */
function loggable({ to, subject }) {
  const addr = String(to || '');
  const at = addr.indexOf('@');
  return {
    to: at > 0 ? `${addr.slice(0, Math.min(2, at))}•••${addr.slice(at)}` : (addr ? '•••' : null),
    subject: String(subject || '').replace(/[0-9]{3,}/g, '•••'),
  };
}

/**
 * @returns {Promise<{sent: boolean, reason?: string}>} — never rejects.
 */
async function send({ to, subject, html, replyTo }) {
  if (!configured()) {
    // Loud in development, where the usual reason is an unset key and the usual
    // symptom is silence.
    logger.warn(loggable({ to, subject }), 'email not sent: BREVO_API_KEY is not set');
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
      logger.error({ ...loggable({ to, subject }), status: res.status, body: body.slice(0, 300) },
        'email rejected by Brevo');
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    logger.error({ err: err.message, ...loggable({ to, subject }) }, 'email failed');
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * BRD §18 — THE COMMISSION INVOICE, from issue to settlement.
 *
 * Every link points at the event's own Commission page
 * (`/organizer/events/:id/commission`), where the receipt is uploaded. They
 * used to point at `/organizer/payouts`, which became a redirect to Payment
 * methods — a page with no invoice on it — so the button in every invoice
 * email led nowhere useful.
 *
 * Dates are on the EVENT's clock with the zone named: the gate shuts at that
 * moment at the venue. They were printed in UTC with no zone at all.
 *
 * `instructions` is the platform's own "how to pay us" text (the
 * `manual_invoice.payment_instructions` setting). The invoice number is the
 * payment reference, so a transfer can be matched to its invoice.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function invoiceDue(invoice, event) {
  return T.whenText(invoice.due_at, event?.timezone || null) || 'soon';
}

function howToPay(invoice, instructions) {
  const steps = instructions
    ? `${T.p('<strong>How to pay</strong>')}
        ${T.note('info', escapeHtml(instructions).replace(/\r?\n/g, '<br>'))}`
    : T.p('Pay by bank transfer using the details Eventsli gave you.');
  return `${steps}
        ${T.p(`Use <strong>${escapeHtml(invoice.number)}</strong> as the payment reference, then
          upload the receipt on the event&rsquo;s Commission page.`)}`;
}

/** An invoice was raised — what is owed, by when, how to pay, and the consequence. */
async function sendInvoiceIssued({ to, organizerName, invoice, event, url, instructions }) {
  return send({
    to,
    subject: `Commission invoice ${invoice.number} — ${event.title}`,
    html: T.layout({
      title: 'Commission due',
      preheader: `${money(invoice.amount_cents, invoice.currency)} due ${invoiceDue(invoice, event)}`,
      reason: 'You are receiving this because you have an organizer account on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.p('Commission on the sales you recorded at the door for this event is now due. Card sales are not included — their commission was taken at checkout.')}
        ${T.eventCard(event)}
        ${T.facts([
    ['Invoice', invoice.number],
    ['Door sales covered', `${invoice.order_count} sale${invoice.order_count === 1 ? '' : 's'}`],
    ['Amount', money(invoice.amount_cents, invoice.currency)],
    ['Due', invoiceDue(invoice, event)],
  ])}
        ${T.note('warning', `
          If it is not settled by the due date, <strong>ticket scanning for this event is switched
          off</strong> until it is. Your account and your other events are not affected.`)}
        ${howToPay(invoice, instructions)}
        ${url ? T.button(url, 'Open the invoice') : ''}`,
    }),
  });
}

/** What is still to pay: the balance when part has been paid, else the amount. */
function stillOwed(invoice) {
  const balance = invoice.balance_cents ?? (Number(invoice.amount_cents) - Number(invoice.paid_cents || 0) - Number(invoice.written_off_cents || 0));
  return money(Number.isFinite(balance) ? balance : invoice.amount_cents, invoice.currency);
}

/**
 * Sent once, when an invoice falls due. What it says about the door is what
 * the door is actually doing (`gate`, from scanner_is_locked): switched off;
 * still on for a grace period; or unaffected, because an admin keeps this
 * event open or enforcement is off for the platform. Saying "scanning
 * disabled" about an open gate sends an organizer into a panic for nothing.
 *
 * `receiptSent`: a receipt is waiting for review — they are told that, not
 * asked to upload it again.
 */
async function sendInvoiceOverdue({ to, organizerName, invoice, event, url, instructions, receiptSent = false, gate = { locked: true } }) {
  const shut = Boolean(gate?.locked);
  const locksAt = !shut && gate?.locks_at ? T.whenText(gate.locks_at, event?.timezone || null) : null;
  const door = shut
    ? T.note('danger', `
          Invoice <strong>${escapeHtml(invoice.number)}</strong> — <strong>${escapeHtml(stillOwed(invoice))}</strong>
          to pay — is past its due date, so ticket scanning for this event is <strong>now switched off</strong>.`)
    : locksAt
      ? T.note('warning', `
          Invoice <strong>${escapeHtml(invoice.number)}</strong> — <strong>${escapeHtml(stillOwed(invoice))}</strong>
          to pay — is past its due date. If it is not settled, ticket scanning for this event switches off
          <strong>${escapeHtml(locksAt)}</strong>.`)
      : T.note('warning', `
          Invoice <strong>${escapeHtml(invoice.number)}</strong> — <strong>${escapeHtml(stillOwed(invoice))}</strong>
          to pay — is past its due date. Scanning for this event is not affected, but the balance is still owed.`);
  return send({
    to,
    subject: shut ? `Scanning disabled — ${event.title}` : `Invoice overdue — ${invoice.number}`,
    html: T.layout({
      title: shut ? 'Scanning is switched off' : 'Your invoice is overdue',
      preheader: receiptSent
        ? `Invoice ${invoice.number} is past due. We are still checking your receipt.`
        : `Invoice ${invoice.number} is past due.${shut ? ' Settle it to resume scanning.' : ''}`,
      reason: 'You are receiving this because you have an organizer account on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${door}
        ${T.eventCard(event)}
        ${receiptSent
    ? `${T.p(`We have your receipt and are checking it now${shut ? '. Scanning resumes on its own as soon as we confirm the transfer' : ''} — there is nothing more to send.`)}
        ${url ? T.button(url, 'See the invoice') : ''}`
    : `${howToPay(invoice, instructions)}
        ${shut ? T.p('Scanning resumes on its own as soon as we confirm the transfer.') : ''}
        ${url ? T.button(url, 'Upload my receipt') : ''}`}`,
    }),
  });
}

/** A reminder before the due date — sent once by the hourly job, or by an admin. */
async function sendInvoiceReminder({ to, organizerName, invoice, event, url, instructions, gateAffected = true }) {
  return send({
    to,
    subject: `Reminder: ${invoice.number} is due ${invoiceDue(invoice, event)}`,
    html: T.layout({
      title: 'Commission due soon',
      preheader: `${stillOwed(invoice)} due ${invoiceDue(invoice, event)}.`,
      reason: 'You are receiving this because you have an organizer account on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.p(`A reminder that invoice <strong>${escapeHtml(invoice.number)}</strong> is due
          <strong>${escapeHtml(invoiceDue(invoice, event))}</strong>.`)}
        ${T.eventCard(event)}
        ${T.facts([
    ['Invoice', invoice.number],
    ['To pay', stillOwed(invoice)],
    ['Due', invoiceDue(invoice, event)],
  ])}
        ${gateAffected ? T.note('warning', 'If it is not settled by then, <strong>ticket scanning for this event switches off</strong> until it is.') : ''}
        ${howToPay(invoice, instructions)}
        ${url ? T.button(url, 'Open the invoice') : ''}`,
    }),
  });
}

/**
 * Every other change an admin makes to an invoice that the organizer must
 * hear about — a rejected receipt, a payment received, a new due date, a
 * waiver, a void, a reopening. One layout; the caller supplies the words.
 *
 *   tone   'info' | 'warning' | 'danger' — the colour of the reason box
 *   reason the admin's words, shown as they wrote them
 */
async function sendInvoiceUpdate({
  to, organizerName, invoice, event, url, subject, title, lead, reason = null, reasonLabel = 'Reason',
  tone = 'info', facts = [], buttonLabel = 'Open the invoice', instructions = null,
}) {
  return send({
    to,
    subject,
    html: T.layout({
      title,
      preheader: `${invoice.number} — ${event.title}`,
      reason: 'You are receiving this because you have an organizer account on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.p(lead)}
        ${reason ? T.note(tone, `<strong>${escapeHtml(reasonLabel)}:</strong> ${escapeHtml(reason).replace(/\r?\n/g, '<br>')}`) : ''}
        ${T.eventCard(event)}
        ${T.facts([['Invoice', invoice.number], ...facts])}
        ${instructions !== null ? howToPay(invoice, instructions) : ''}
        ${url ? T.button(url, buttonLabel) : ''}`,
    }),
  });
}

/**
 * An admin changed whether scanning works for an event. Sent when the gate
 * actually changed state: closed by Eventsli, or reopened by Eventsli.
 */
async function sendGateChanged({ to, organizerName, event, url, opened, reason, until = null }) {
  const untilText = until ? T.whenText(until, event?.timezone || null) : null;
  return send({
    to,
    subject: opened ? `Scanning is on — ${event.title}` : `Scanning switched off by Eventsli — ${event.title}`,
    html: T.layout({
      title: opened ? 'Scanning is on' : 'Scanning is switched off',
      preheader: opened ? `Eventsli switched scanning back on for ${event.title}.` : `Eventsli switched off scanning for ${event.title}.`,
      reason: 'You are receiving this because you have an organizer account on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${opened
    ? T.p(`Eventsli has switched ticket scanning <strong>on</strong> for this event${untilText ? ` until <strong>${escapeHtml(untilText)}</strong>` : ''}.`)
    : T.note('danger', `Eventsli has switched ticket scanning <strong>off</strong> for this event${untilText ? ` until <strong>${escapeHtml(untilText)}</strong>` : ''}. Nobody can be checked in until it is back on.`)}
        ${reason ? T.note('info', `<strong>Why:</strong> ${escapeHtml(reason)}`) : ''}
        ${T.eventCard(event)}
        ${T.p('Questions? Reply to this email.', { small: true, color: T.MUTED })}
        ${url ? T.button(url, 'Open the event') : ''}`,
    }),
  });
}

/**
 * The money was seen and the invoice is closed. What it says about the door
 * depends on the door: `gateOpen` is the gate as it stands after settling
 * (another overdue invoice or an admin lock can still hold it shut), and
 * `wasOverdue` is whether scanning had actually been off.
 */
async function sendInvoiceSettled({ to, organizerName, invoice, event, url, gateOpen = true, wasOverdue = false }) {
  const door = !gateOpen
    ? T.note('warning', 'Scanning for this event is <strong>still off</strong>: something else is outstanding. The Commission page shows what.')
    : wasOverdue
      ? T.p('<strong>Scanning for this event is on again.</strong>')
      : '';
  return send({
    to,
    subject: `Payment confirmed — ${invoice.number}`,
    html: T.layout({
      title: 'Payment confirmed',
      preheader: `Invoice ${invoice.number} for ${event.title} is settled.`,
      reason: 'You are receiving this because you have an organizer account on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.p('We have confirmed your transfer. Thank you.')}
        ${door}
        ${T.eventCard(event)}
        ${T.facts([
    ['Invoice', invoice.number],
    ['Amount', money(invoice.amount_cents, invoice.currency)],
    ['Status', 'Settled'],
  ])}
        ${url ? T.button(url, 'See your invoices') : ''}`,
    }),
  });
}

/**
 * An organizer uploaded a receipt. Nothing reopens on the claim — an admin has
 * to look at it — and nothing used to tell an admin there was anything to look
 * at, so a receipt could wait unseen while the gate stayed shut.
 */
async function sendInvoiceReceiptToAdmins({ to, organizerName, invoice, event, adminUrl, proofUrl, overdue = false }) {
  return send({
    to,
    subject: `${overdue ? 'Gate shut — ' : ''}Receipt to check — ${invoice.number}`,
    html: T.layout({
      title: 'A commission receipt is waiting',
      preheader: `${organizerName || 'An organizer'} sent a receipt for ${money(invoice.amount_cents, invoice.currency)}.`,
      reason: 'You are receiving this because you are an Eventsli administrator.',
      body: `
        ${T.p(`<strong>${escapeHtml(organizerName || 'An organizer')}</strong> says they have paid invoice
          <strong>${escapeHtml(invoice.number)}</strong> and sent a receipt.`)}
        ${overdue ? T.note('danger', 'This invoice is overdue, so <strong>scanning for the event is off</strong> until it is settled.') : ''}
        ${T.eventCard({ ...event, organizerName })}
        ${T.facts([
    ['Invoice', invoice.number],
    ['Amount', money(invoice.amount_cents, invoice.currency)],
    ['Due', invoiceDue(invoice, event)],
  ])}
        ${proofUrl ? T.p(`Receipt: <a href="${escapeHtml(proofUrl)}">${escapeHtml(proofUrl)}</a>`, { small: true }) : ''}
        ${T.p('Check the money has arrived before settling — the receipt is the organizer&rsquo;s word, not ours.', { small: true, color: T.MUTED })}
        ${adminUrl ? T.button(adminUrl, 'Open commission invoices') : ''}`,
    }),
  });
}

/**
 * BRD §16 — a rejection the organizer can act on, with the admin's reason in
 * their own words. `wasLive`: the event had already been published (events
 * publish straight away unless the platform requires review first), so it has
 * been taken off Eventsli rather than held back.
 */
async function sendEventRejected({ to, organizerName, event, reason, wasLive = false }) {
  const site = T.siteUrl();
  return send({
    to,
    subject: wasLive ? `Taken down for changes — ${event.title}` : `Changes needed — ${event.title}`,
    html: T.layout({
      title: wasLive ? 'Your event was taken down for changes' : 'Changes needed before publishing',
      preheader: wasLive ? 'An Eventsli admin reviewed it. Here is why, and what to do next.' : 'One change and it can go back for review.',
      reason: 'You are receiving this because you published an event on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.p(wasLive
          ? 'An Eventsli admin reviewed your event and has taken it off the site until it is changed. Their reason:'
          : 'Your event was reviewed and needs a change before it can go on sale:')}
        ${T.quote(reason)}
        ${T.eventCard(event)}
        ${wasLive ? T.note('info', 'Tickets already sold stay valid. Nobody can buy new ones while the event is down.') : ''}
        ${T.p('Make the change in your dashboard and publish it again.')}
        ${site && event.id ? T.button(`${site}/organizer/events/${event.id}`, 'Open my event') : ''}
        ${T.p('Questions about this decision? Reply to this email or contact the Eventsli team.', { small: true, color: T.MUTED })}`,
    }),
  });
}

/** An admin pulled a live event from view (reversible). The reason is the admin's. */
async function sendEventSuspended({ to, organizerName, event, reason }) {
  const site = T.siteUrl();
  return send({
    to,
    subject: `Suspended — ${event.title}`,
    html: T.layout({
      title: 'Your event has been suspended',
      preheader: 'It is off Eventsli for now. Here is why.',
      reason: 'You are receiving this because you published an event on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.p('An Eventsli admin has suspended your event. It is not visible on Eventsli and nobody can buy tickets for it. Their reason:')}
        ${T.quote(reason)}
        ${T.eventCard(event)}
        ${T.note('info', 'This is not a cancellation: tickets already sold stay valid, and Eventsli can put the event back.')}
        ${site && event.id ? T.button(`${site}/organizer/events/${event.id}`, 'Open my event') : ''}
        ${T.p('Questions about this decision? Reply to this email or contact the Eventsli team.', { small: true, color: T.MUTED })}`,
    }),
  });
}

/** An admin cancelled the event outright (BRD §17) — terminal. */
async function sendEventCancelledByAdmin({ to, organizerName, event, reason }) {
  return send({
    to,
    subject: `Cancelled by Eventsli — ${event.title}`,
    html: T.layout({
      title: 'Your event has been cancelled',
      preheader: 'An Eventsli admin cancelled it. Here is why.',
      reason: 'You are receiving this because you published an event on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.p('An Eventsli admin has cancelled your event and removed it from Eventsli. Their reason:')}
        ${T.quote(reason)}
        ${T.eventCard(event)}
        ${T.note('warning', 'Its tickets no longer admit anyone at the door. Any refunds to buyers are arranged between you and them.')}
        ${T.p('Questions about this decision? Reply to this email or contact the Eventsli team.', { small: true, color: T.MUTED })}`,
    }),
  });
}

/** A suspended event is back on Eventsli. */
async function sendEventRestored({ to, organizerName, event, url }) {
  return send({
    to,
    subject: `Back online — ${event.title}`,
    html: T.layout({
      title: 'Your event is back on Eventsli',
      preheader: 'The suspension has been lifted.',
      reason: 'You are receiving this because you published an event on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.p('An Eventsli admin has lifted the suspension. Your event is visible again and tickets are on sale.')}
        ${T.eventCard(event)}
        ${url ? T.button(url, 'View my event page') : ''}`,
    }),
  });
}

/**
 * To every admin: a new event just went live without waiting for review, and
 * here is where to look at it. Review now happens after publishing.
 */
async function sendEventPublishedToAdmins({ to, event, organizerName, adminUrl, publicUrl }) {
  return send({
    to,
    subject: `New event live — ${event.title}`,
    html: T.layout({
      title: 'A new event was just published',
      preheader: `${organizerName || 'An organizer'} published ${event.title}. Review it when you can.`,
      reason: 'You are receiving this because you are an Eventsli administrator.',
      body: `
        ${T.p(`<strong>${escapeHtml(organizerName || 'An organizer')}</strong> published a new ${event.listingType === 'display_only' ? 'listing' : 'ticketed event'}. It is live on Eventsli now.`)}
        ${T.eventCard({ ...event, organizerName })}
        ${adminUrl ? T.button(adminUrl, 'Review it in the admin console') : ''}
        ${T.p(`If something is wrong, <strong>Reject</strong> takes it down and emails the organizer your reason; <strong>Suspend</strong> and <strong>Cancel</strong> do the same.${publicUrl ? ` Public page: <a href="${escapeHtml(publicUrl)}">${escapeHtml(publicUrl)}</a>` : ''}`, { small: true, color: T.MUTED })}`,
    }),
  });
}

/** The event is live — approved by an admin, or (`direct`) published straight away. */
async function sendEventApproved({ to, organizerName, event, url, direct = false }) {
  const sells = event.listingType !== 'display_only';
  return send({
    to,
    subject: `${event.title} is live`,
    html: T.layout({
      title: 'Your event is live',
      preheader: `${event.title} is now on Eventsli${sells ? ' and on sale' : ''}.`,
      reason: 'You are receiving this because you published an event on Eventsli.',
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')},`)}
        ${T.p(`Your event ${direct ? 'is published' : 'has been approved'} and is now ${sells ? 'on sale' : 'listed on Eventsli'}. Here is what people will see:`)}
        ${direct ? T.p('Eventsli reviews new events after they go live. If anything needs to change, we will email you with the reason.', { small: true, color: T.MUTED }) : ''}
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
  loggable,
  configured,
  send,
  escapeHtml,
  sendTickets,
  sendInvoiceIssued,
  sendInvoiceOverdue,
  sendInvoiceSettled,
  sendInvoiceReceiptToAdmins,
  sendInvoiceReminder,
  sendInvoiceUpdate,
  sendGateChanged,
  sendEventRejected,
  sendEventApproved,
  sendEventSuspended,
  sendEventCancelledByAdmin,
  sendEventRestored,
  sendEventPublishedToAdmins,
  sendTicketTransferred,
  sendVerificationCode,
  sendCancellationRequested,
  sendCancellationDecided,
  sendDoorTeamAdded,
};
