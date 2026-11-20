const { send, escapeHtml } = require('./emailService');
const T = require('./emailTemplates');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The sponsorship emails (2026-11-20). Best effort, like every email here:
 * nothing in a deal is undone because a message did not go.
 *
 * Every sponsor-facing message links to the sponsor portal, never carries the
 * agreement itself: the portal is where it is read, signed and paid, behind a
 * sign-in with the address the email went to.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const site = () => T.siteUrl();
const portalUrl = (dealId) => (site() ? `${site()}/account/sponsorships/${dealId}` : null);
const organizerUrl = (eventId, dealId) => (site() ? `${site()}/organizer/events/${eventId}/sponsors/${dealId}` : null);

const ORGANIZER_REASON = 'You are receiving this because you run this event on Eventsli and use its sponsorship tools.';
const SPONSOR_REASON = 'You are receiving this because you are the contact for a sponsorship of this event on Eventsli.';

/** A brand asked to sponsor — to the organizer. */
async function inquiryToOrganizer({ to, organizerName, event, deal, packageName }) {
  return send({
    to,
    replyTo: deal.contact_email,
    subject: `New sponsor inquiry — ${deal.company_name}`,
    html: T.layout({
      title: 'A new sponsor inquiry',
      preheader: `${deal.company_name} would like to sponsor ${event.title}.`,
      reason: ORGANIZER_REASON,
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')}, <strong>${escapeHtml(deal.company_name)}</strong> would like to sponsor your event.`)}
        ${T.eventCard(event)}
        ${T.facts([['Company', deal.company_name], ['Contact', deal.contact_name], ['Email', deal.contact_email],
    ['Phone', deal.contact_phone], ['Website', deal.website], ['Interested in', packageName]])}
        ${deal.message ? T.note('info', `<span style="color:${T.INK}">${escapeHtml(deal.message).replace(/\r?\n/g, '<br>')}</span>`) : ''}
        ${T.button(organizerUrl(event.id, deal.id), 'Open the lead')}
        ${T.p('Reply to this email to answer them directly, or send a proposal from the lead.', { small: true, color: T.MUTED })}`,
    }),
  });
}

/** The brand's own copy of their inquiry. */
async function inquiryReceipt({ to, contactName, event, organizerName }) {
  return send({
    to,
    subject: `We passed on your sponsorship inquiry — ${event.title}`,
    html: T.layout({
      title: 'Your inquiry was sent',
      preheader: `${organizerName || 'The organizer'} has your sponsorship inquiry for ${event.title}.`,
      reason: SPONSOR_REASON,
      body: `
        ${T.p(`Hi ${escapeHtml(contactName || 'there')}, thank you for your interest in sponsoring <strong>${escapeHtml(event.title)}</strong>. ${escapeHtml(organizerName || 'The organizer')} has your inquiry and will get back to you.`)}
        ${T.eventCard({ ...event, organizerName })}
        ${T.p('If they send you a proposal, you will get an email with a link to read, sign and pay it on Eventsli.', { small: true, color: T.MUTED })}`,
    }),
  });
}

/** A proposal (or a revised one) — to the sponsor. */
async function proposal({ to, contactName, event, organizerName, deal, revised = false }) {
  const expires = deal.proposal_expires_at ? T.whenText(deal.proposal_expires_at, event.timezone) : null;
  return send({
    to,
    subject: `${revised ? 'Updated sponsorship proposal' : 'Sponsorship proposal'} — ${event.title}`,
    html: T.layout({
      title: revised ? 'Your proposal was updated' : 'You have a sponsorship proposal',
      preheader: `${organizerName || 'The organizer'} sent a sponsorship proposal for ${event.title}.`,
      reason: SPONSOR_REASON,
      body: `
        ${T.p(`Hi ${escapeHtml(contactName || 'there')}, ${escapeHtml(organizerName || 'the organizer')} ${revised ? 'updated the' : 'sent you a'} sponsorship proposal for <strong>${escapeHtml(event.title)}</strong>.`)}
        ${T.eventCard({ ...event, organizerName })}
        ${T.facts([['Sponsor', deal.company_name], ['Amount', Number(deal.amount_cents) > 0 ? T.money(deal.amount_cents, deal.currency) : 'In kind (no payment)'],
    ['Reply by', expires]])}
        ${T.button(portalUrl(deal.id), 'Review and sign')}
        ${T.p(`Sign in with <strong>${escapeHtml(to)}</strong> to open it. If you do not have an Eventsli account yet, create one with this address.`, { small: true, color: T.MUTED })}`,
    }),
  });
}

/** The sponsor signed — to the organizer. */
async function signedToOrganizer({ to, organizerName, event, deal }) {
  return send({
    to,
    subject: `Signed — ${deal.company_name} is sponsoring ${event.title}`,
    html: T.layout({
      title: 'A sponsorship was signed',
      preheader: `${deal.company_name} signed the sponsorship agreement.`,
      reason: ORGANIZER_REASON,
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')}, <strong>${escapeHtml(deal.company_name)}</strong> signed the sponsorship agreement for your event.`)}
        ${T.eventCard(event)}
        ${T.facts([['Signed by', deal.signer_name], ['Amount', Number(deal.amount_cents) > 0 ? T.money(deal.amount_cents, deal.currency) : 'In kind (no payment)']])}
        ${T.p(Number(deal.amount_cents) > 0
    ? 'Their logo goes on your event page automatically once the sponsorship is paid in full.'
    : 'Nothing is owed, so their logo is now on your event page.')}
        ${T.button(organizerUrl(event.id, deal.id), 'Open the deal')}`,
    }),
  });
}

/** A payment was recorded — to the organizer or the sponsor. */
async function paymentRecorded({ to, name, event, deal, amountCents, forOrganizer, fullyPaid }) {
  const amount = T.money(amountCents, deal.currency);
  const outstanding = Math.max(0, Number(deal.amount_cents) - Number(deal.paid_cents));
  return send({
    to,
    subject: `${fullyPaid ? 'Paid in full' : 'Payment received'} — ${deal.company_name} · ${event.title}`,
    html: T.layout({
      title: fullyPaid ? 'Sponsorship paid in full' : 'Payment received',
      preheader: `${amount} received for the ${deal.company_name} sponsorship.`,
      reason: forOrganizer ? ORGANIZER_REASON : SPONSOR_REASON,
      body: `
        ${T.p(`Hi ${escapeHtml(name || 'there')}, a payment of <strong>${escapeHtml(amount)}</strong> was recorded for the ${escapeHtml(deal.company_name)} sponsorship of <strong>${escapeHtml(event.title)}</strong>.`)}
        ${T.facts([['Paid so far', T.money(deal.paid_cents, deal.currency)], ['Still to pay', outstanding > 0 ? T.money(outstanding, deal.currency) : null]])}
        ${fullyPaid ? T.note('info', `<span style="color:${T.INK}">The sponsorship is paid in full and the logo is now shown on the event page.</span>`) : ''}
        ${T.button(forOrganizer ? organizerUrl(event.id, deal.id) : portalUrl(deal.id), forOrganizer ? 'Open the deal' : 'View your sponsorship')}`,
    }),
  });
}

module.exports = {
  inquiryToOrganizer, inquiryReceipt, proposal, signedToOrganizer, paymentRecorded, portalUrl, organizerUrl,
};
