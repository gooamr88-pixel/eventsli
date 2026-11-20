const { send, escapeHtml } = require('./emailService');
const T = require('./emailTemplates');

/**
 * The vendor emails (2026-11-20). Best effort, like every email here. Vendor-
 * facing messages link to the vendor portal (Account › Vendor bookings),
 * behind a sign-in with the address the email went to.
 */

const site = () => T.siteUrl();
const portalUrl = (id) => (site() ? `${site()}/account/vendors/${id}` : null);
const organizerUrl = (eventId, id) => (site() ? `${site()}/organizer/events/${eventId}/vendors/${id}` : null);

const ORGANIZER_REASON = 'You are receiving this because you run this event on Eventsli and use its vendor tools.';
const VENDOR_REASON = 'You are receiving this because you applied to be a vendor at this event on Eventsli.';

async function applicationToOrganizer({ to, organizerName, event, app }) {
  return send({
    to,
    replyTo: app.contact_email,
    subject: `New vendor application — ${app.business_name}`,
    html: T.layout({
      title: 'A new vendor application',
      preheader: `${app.business_name} applied to be a vendor at ${event.title}.`,
      reason: ORGANIZER_REASON,
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')}, <strong>${escapeHtml(app.business_name)}</strong> applied to be a vendor at your event.`)}
        ${T.eventCard(event)}
        ${T.facts([['Business', app.business_name], ['Category', app.category], ['Contact', app.contact_name], ['Email', app.contact_email], ['Phone', app.contact_phone]])}
        ${app.description ? T.note('info', `<span style="color:${T.INK}">${escapeHtml(app.description).replace(/\r?\n/g, '<br>')}</span>`) : ''}
        ${T.button(organizerUrl(event.id, app.id), 'Review the application')}`,
    }),
  });
}

async function applicationReceipt({ to, contactName, event, organizerName }) {
  return send({
    to,
    subject: `Application received — ${event.title}`,
    html: T.layout({
      title: 'Your vendor application was sent',
      preheader: `${organizerName || 'The organizer'} has your vendor application for ${event.title}.`,
      reason: VENDOR_REASON,
      body: `
        ${T.p(`Hi ${escapeHtml(contactName || 'there')}, thank you for applying to be a vendor at <strong>${escapeHtml(event.title)}</strong>. ${escapeHtml(organizerName || 'The organizer')} will review it and get back to you.`)}
        ${T.eventCard({ ...event, organizerName })}
        ${T.p('If you are offered a space you will get an email with a link to accept and pay for it on Eventsli. You can follow your application under Account › Vendor bookings, signed in with this address.', { small: true, color: T.MUTED })}`,
    }),
  });
}

async function offer({ to, contactName, event, organizerName, app, boothName, revised = false }) {
  const expires = app.offer_expires_at ? T.whenText(app.offer_expires_at, event.timezone) : null;
  return send({
    to,
    subject: `${revised ? 'Updated vendor offer' : 'You have a vendor space'} — ${event.title}`,
    html: T.layout({
      title: revised ? 'Your offer was updated' : 'You are offered a space',
      preheader: `${organizerName || 'The organizer'} offered ${app.business_name} a space at ${event.title}.`,
      reason: VENDOR_REASON,
      body: `
        ${T.p(`Hi ${escapeHtml(contactName || 'there')}, good news — ${escapeHtml(organizerName || 'the organizer')} ${revised ? 'updated the offer of' : 'is offering'} a vendor space at <strong>${escapeHtml(event.title)}</strong> to ${escapeHtml(app.business_name)}.`)}
        ${T.eventCard({ ...event, organizerName })}
        ${T.facts([['Space', boothName], ['Booth', app.booth_label], ['Booth fee', Number(app.amount_cents) > 0 ? T.money(app.amount_cents, app.currency) : 'Free'],
    ['Staff passes', String(app.staff_passes)], ['Reply by', expires]])}
        ${T.button(portalUrl(app.id), 'Review and accept')}
        ${T.p(`Sign in with <strong>${escapeHtml(to)}</strong> to open it. If you do not have an Eventsli account yet, create one with this address.`, { small: true, color: T.MUTED })}`,
    }),
  });
}

async function closed({ to, contactName, event, organizerName, outcome, reason }) {
  const cancelled = outcome === 'cancelled';
  return send({
    to,
    subject: `${cancelled ? 'Vendor booking cancelled' : 'Your vendor application'} — ${event.title}`,
    html: T.layout({
      title: cancelled ? 'Your booking was cancelled' : 'About your application',
      preheader: `An update on your vendor application for ${event.title}.`,
      reason: VENDOR_REASON,
      body: `
        ${T.p(cancelled
    ? `Hi ${escapeHtml(contactName || 'there')}, ${escapeHtml(organizerName || 'the organizer')} has cancelled your vendor booking at <strong>${escapeHtml(event.title)}</strong>. If you paid, they will contact you about a refund.`
    : `Hi ${escapeHtml(contactName || 'there')}, thank you for applying to be a vendor at <strong>${escapeHtml(event.title)}</strong>. Unfortunately ${escapeHtml(organizerName || 'the organizer')} is not able to offer you a space this time.`)}
        ${reason ? T.quote(reason) : ''}
        ${T.eventCard({ ...event, organizerName })}`,
    }),
  });
}

async function acceptedToOrganizer({ to, organizerName, event, app }) {
  return send({
    to,
    subject: `Accepted — ${app.business_name} · ${event.title}`,
    html: T.layout({
      title: 'A vendor accepted their offer',
      preheader: `${app.business_name} accepted and signed for their space.`,
      reason: ORGANIZER_REASON,
      body: `
        ${T.p(`Hi ${escapeHtml(organizerName || 'there')}, <strong>${escapeHtml(app.business_name)}</strong> accepted their vendor offer and signed the terms.`)}
        ${T.eventCard(event)}
        ${T.facts([['Signed by', app.signer_name], ['Booth', app.booth_label], ['Booth fee', Number(app.amount_cents) > 0 ? T.money(app.amount_cents, app.currency) : 'Free']])}
        ${T.button(organizerUrl(event.id, app.id), 'Open the booking')}`,
    }),
  });
}

async function paid({ to, name, event, app, forOrganizer, vendorInfo = null }) {
  return send({
    to,
    subject: `Booth fee paid — ${app.business_name} · ${event.title}`,
    html: T.layout({
      title: forOrganizer ? 'A booth fee was paid' : 'You are booked in',
      preheader: `${T.money(app.amount_cents, app.currency)} received for ${app.business_name}.`,
      reason: forOrganizer ? ORGANIZER_REASON : VENDOR_REASON,
      body: `
        ${T.p(forOrganizer
    ? `Hi ${escapeHtml(name || 'there')}, the booth fee of <strong>${escapeHtml(T.money(app.amount_cents, app.currency))}</strong> for ${escapeHtml(app.business_name)} was recorded.`
    : `Hi ${escapeHtml(name || 'there')}, your booth fee of <strong>${escapeHtml(T.money(app.amount_cents, app.currency))}</strong> was received. You are booked in as a vendor at <strong>${escapeHtml(event.title)}</strong>.`)}
        ${T.eventCard(event)}
        ${T.facts([['Booth', app.booth_label], ['Staff passes', String(app.staff_passes)]])}
        ${!forOrganizer && vendorInfo ? T.note('info', `<span style="color:${T.INK}"><strong>For the day</strong><br>${escapeHtml(vendorInfo).replace(/\r?\n/g, '<br>')}</span>`) : ''}
        ${!forOrganizer ? T.p('Add the names of your staff in your booking so they are on the door list.', { small: true, color: T.MUTED }) : ''}
        ${T.button(forOrganizer ? organizerUrl(event.id, app.id) : portalUrl(app.id), forOrganizer ? 'Open the booking' : 'View your booking')}`,
    }),
  });
}

module.exports = { applicationToOrganizer, applicationReceipt, offer, closed, acceptedToOrganizer, paid, portalUrl, organizerUrl };
