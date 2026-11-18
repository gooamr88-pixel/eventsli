'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { get, post } from '../../../utils/apiClient';
import { messageFor } from '../../../utils/errors';
import { templateFacts } from '../../../components/templates/TemplateCard';

/**
 * Starting an event from a template (2026-11-19). `?template=<id>` on the
 * new-event page: the template is read first, the wizard opens pre-filled from
 * it (`initialForm`), and once POST /events has made the event,
 * `applyTemplate` copies the ticket types, add-ons and seating map into it.
 */
export function useTemplate(id) {
  const [state, setState] = useState({ template: null, error: null, loading: Boolean(id) });
  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const template = await get(`/organizer/templates/${encodeURIComponent(id)}`, { cache: 'no-store', noRedirect: true });
        if (!cancelled) setState({ template, error: null, loading: false });
      } catch (error) {
        if (!cancelled) setState({ template: null, error, loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [id]);
  return state;
}

/** The wizard's answers a template suggests. Dates are always the organizer's. */
export function formFromTemplate(template, base) {
  const e = template?.data?.event || {};
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  return {
    ...base,
    title: str(e.title) || base.title,
    category: e.category || base.category,
    description: str(e.description),
    timezone: e.timezone || base.timezone,
    venueName: str(e.venueName), venueAddress: str(e.venueAddress), city: str(e.city),
    venuePlaceId: str(e.venuePlaceId), venueLat: str(e.venueLat), venueLng: str(e.venueLng),
    ...(e.admissionType ? { admissionType: e.admissionType } : {}),
    ...(e.purchaseMode ? { purchaseMode: e.purchaseMode } : {}),
    ...(e.feeBearer ? { feeBearer: e.feeBearer } : {}),
    ...(e.maxTicketsPerOrder ? { maxTicketsPerOrder: String(e.maxTicketsPerOrder) } : {}),
    ...(typeof e.allowTicketTransfer === 'boolean' ? { allowTicketTransfer: e.allowTicketTransfer } : {}),
  };
}

/**
 * Copies the template into the new event. Never throws: the event exists
 * either way, so a failure is reported, not fatal. Returns a toast's words.
 */
export async function applyTemplate(eventId, template) {
  try {
    const r = await post(`/events/${eventId}/apply-template`, { templateId: template.id }, { noRedirect: true });
    const parts = [
      r.tiers && `${r.tiers} ticket type${r.tiers === 1 ? '' : 's'}`,
      r.addons && `${r.addons} add-on${r.addons === 1 ? '' : 's'}`,
      r.tables && `a ${r.tables}-table seating map`,
    ].filter(Boolean);
    return {
      ok: true,
      text: parts.length ? `Added ${parts.join(', ')} from “${template.name}”.` : `Started from “${template.name}”.`,
      warnings: r.warnings || [],
    };
  } catch (err) {
    return { ok: false, text: `The event was created, but the template could not be applied: ${messageFor(err)}`, warnings: [] };
  }
}

/** The line above the wizard saying which template it started from. */
export function TemplateBanner({ template }) {
  const e = template.data?.event || {};
  const facts = templateFacts(template.summary);
  return (
    <div className="es-notice es-notice--info es-tplbanner" role="status">
      <p>
        <b>Starting from “{template.name}”.</b>{' '}
        {facts.length ? `${facts.join(', ')} will be added when you create the event.` : 'Its details are filled in below.'}
        {e.startTime ? ` It usually starts at ${e.startTime}.` : ''}
      </p>
      <Link href="/organizer/events/new" className="es-linkbtn">Start blank instead</Link>
    </div>
  );
}
