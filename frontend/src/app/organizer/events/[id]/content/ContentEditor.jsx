'use client';

import Link from 'next/link';
import { SectionHeader } from '../../../../components/ui/Page';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import { useEventContext } from '../EventContext';
import CoverUpload from '../CoverUpload';
import BrandingEditor from './BrandingEditor';
import GalleryEditor from './GalleryEditor';
import ScheduleEditor from './ScheduleEditor';
import SponsorsEditor from './SponsorsEditor';
import PoliciesEditor from './PoliciesEditor';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything that makes the event PAGE, in one screen.
 *
 * The cover, the logo, the highlights, the gallery, the schedule, the sponsors
 * and the policies. Gathered here rather than scattered through the event's
 * settings form because they are one job done in one sitting: an organizer
 * builds their page, they do not "configure branding" and separately
 * "configure sponsors".
 *
 * ONE PAGE, NOT TABS. Each section is short, most are empty on a new event, and
 * tabs would hide exactly the sections an organizer does not yet know they
 * could fill in — which is the whole problem this screen exists to solve.
 * Ordered the way the event page itself is read, top to bottom, so scrolling
 * this screen and scrolling the result feel like the same journey.
 *
 * EVERY SECTION IS OPTIONAL and none of it gates publishing. An event with a
 * title, a date and a ticket type is a complete event; this is what turns it
 * into one somebody wants to go to.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ContentEditor({ eventId }) {
  const ctx = useEventContext();
  const event = ctx?.event;

  if (ctx?.error) return <ErrorNotice error={ctx.error} />;
  if (!event) return <Loading variant="card" label="Loading the event" />;

  return (
    <div className="fx-stack">
      <SectionHeader
        title="Page & branding"
        lede="What people see on your event page. All of it is optional — add what you have."
        /**
         * ONLY ONCE IT IS PUBLIC. `/e/:slug` serves published events and
         * nothing else — `eventBySlug` filters on `status = 'published'` — so
         * on a draft, which is every event that is still being built, the one
         * button in this header opened a 404. This is the screen an organizer
         * spends the longest on; it was also the screen most likely to be a
         * draft. The event header's own "Public page" link has always been
         * guarded this way, and this is now the same rule.
         */
        actions={event.slug && event.status === 'published' && (
          <a
            href={`/e/${event.slug}`}
            target="_blank"
            rel="noreferrer"
            className="es-btn es-btn--secondary es-btn--sm"
          >
            Preview page<span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      />

      <CoverUpload event={event} onChanged={ctx.refresh} />
      <BrandingEditor event={event} onChanged={ctx.refresh} />
      <GalleryEditor eventId={eventId} />
      <ScheduleEditor eventId={eventId} timezone={event.timezone} />
      <SponsorsEditor eventId={eventId} />
      <PoliciesEditor eventId={eventId} />

      <p className="text-sm text-subtle">
        The description, venue and dates live on the{' '}
        <Link href={`/organizer/events/${eventId}`} className="text-accent">event overview</Link>.
      </p>
    </div>
  );
}
