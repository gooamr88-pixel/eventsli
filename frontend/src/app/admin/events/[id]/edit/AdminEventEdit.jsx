'use client';

import Link from 'next/link';
import { useApi } from '../../../../hooks/useApi';
import { Loading, ErrorNotice, Notice } from '../../../../components/Feedback';
import { PageHeader } from '../../../../components/ui/Page';
import EventDetailsEditor from '../../../../organizer/events/[id]/EventDetailsEditor';
import CoverUpload from '../../../../organizer/events/[id]/CoverUpload';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AN ADMIN EDITS ANY EVENT, COMPLETELY (owner, 2026-11-24: "complete ability
 * for admin to edit event details").
 *
 * The organizer's own form (EventDetailsEditor), in admin mode: every field
 * editable whatever the event's state — title, category, dates, venue, how
 * tickets work, payments, privacy — saved at once with no review, because an
 * admin's edit IS the review. The API already allows it (eventRules
 * editConsequence: "an admin is held to neither rule") and records each
 * change on the audit trail with what it was, what it became and the reason
 * typed here. The cover image is changed beside it.
 *
 * Fees, tax and commission stay on the event page (FeeEditor), where their
 * preview is.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AdminEventEdit({ eventId }) {
  const { data: event, error, loading, reload } = useApi(`/events/${eventId}`);

  if (error) {
    return <ErrorNotice error={error} onRetry={reload} action={{ href: `/admin/events/${eventId}`, label: 'Back to the event' }} />;
  }
  if (loading && !event) return <Loading variant="card" label="Loading the event" />;

  const closed = ['cancelled', 'completed'].includes(event.status);

  return (
    <div className="fx-stack">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/admin/events" className="fx-touch hover:text-ink">All events</Link>
        <span aria-hidden> / </span>
        <Link href={`/admin/events/${eventId}`} className="fx-touch hover:text-ink">{event.title}</Link>
        <span aria-hidden> / </span>
        <span className="text-ink" aria-current="page">Edit</span>
      </nav>

      <PageHeader
        eyebrow="Admin edit"
        title={`Edit “${event.title}”`}
        lede="Every change saves straight away, with no review, and is kept on the audit record with the reason you give."
      />

      {closed ? (
        <Notice title="This event can no longer be edited.">
          <p>It is {event.status}, so its details are kept as a record of how it was sold.</p>
        </Notice>
      ) : (
        <>
          <section className="es-dcard" aria-label="Cover image">
            <h2 className="es-dcard__title">Cover image</h2>
            <CoverUpload event={event} onChanged={reload} />
          </section>
          <EventDetailsEditor event={event} onSaved={reload} asAdmin />
        </>
      )}
    </div>
  );
}
