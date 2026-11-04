'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import { useToast } from '../../../../components/ui/Toast';
import { useEventContext } from '../EventContext';
import { useRunStepSave } from '../BuildStep';
import CoverUpload from '../CoverUpload';
import { LogoCard, HighlightsCard, MapPinCard } from './BrandingEditor';
import GalleryEditor from './GalleryEditor';
import ScheduleEditor from './ScheduleEditor';
import SponsorsEditor from './SponsorsEditor';
import PoliciesEditor from './PoliciesEditor';
import LivePreview from './LivePreview';
import { useContentSection } from './useContentSection';

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
 * ONE PAGE, NOT TABS — and that survives the 2026-11 layout. The row of tabs
 * across the top is a set of JUMP LINKS to sections that are all on the page,
 * not panels that hide each other: tabs that hid sections would hide exactly
 * the ones an organizer does not yet know they could fill in, which is the
 * whole problem this screen exists to solve. The long list sections fold, but
 * a folded section is still a row with its name and its count.
 *
 * EVERY SECTION IS OPTIONAL and none of it gates publishing. An event with a
 * title, a date and a ticket type is a complete event; this is what turns it
 * into one somebody wants to go to.
 *
 * THE LISTS ARE LOADED HERE, once each, and handed to both their editor and
 * the live preview — so the preview is the saved page, not a guess at it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const JUMPS = [
  { id: 'pb-appearance', label: 'Appearance', icon: 'image' },
  { id: 'pb-content', label: 'Content', icon: 'fileText' },
  { id: 'pb-experience', label: 'Experience', icon: 'sparkle' },
  { id: 'pb-info', label: 'Additional info', icon: 'layers' },
];

export default function ContentEditor({ eventId }) {
  const ctx = useEventContext();
  const event = ctx?.event;
  const media = useContentSection(eventId, 'media');
  const schedule = useContentSection(eventId, 'schedule');
  const sponsors = useContentSection(eventId, 'sponsors');
  const runSave = useRunStepSave();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState(JUMPS[0].id);

  // Which section is in view lights its jump link. The setState is in the
  // observer's callback, not the effect body.
  useEffect(() => {
    if (!event || typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActive(top.target.id);
    }, { rootMargin: '-120px 0px -55% 0px' });
    JUMPS.forEach((j) => { const el = document.getElementById(j.id); if (el) seen.observe(el); });
    return () => seen.disconnect();
  }, [event]);

  if (ctx?.error) return <ErrorNotice error={ctx.error} onRetry={ctx.refresh} />;
  if (!event) return <Loading variant="card" label="Loading the event" />;

  /**
   * ONLY ONCE IT IS PUBLIC. `/e/:slug` serves published events and nothing
   * else — `eventBySlug` filters on `status = 'published'` — so on a draft the
   * preview link would open a 404. Shown disabled there, with the reason.
   */
  const publicUrl = event.slug && event.status === 'published' ? `/e/${event.slug}` : null;

  /** Saves every section that is waiting — the same registry the step bar's
   *  "Save and continue" runs. Sections with nothing pending return at once. */
  async function saveAll() {
    if (!runSave) return;
    setSaving(true);
    try {
      const ok = await runSave();
      if (ok) toast.success('Everything on this page is saved.');
      else toast.error('One section did not save. Its own message says why.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="es-pb">
      <nav className="es-dtabs" aria-label="Page & branding sections">
        {JUMPS.map((j) => (
          <a
            key={j.id}
            href={`#${j.id}`}
            className="es-dtabs__tab"
            aria-current={active === j.id ? 'true' : undefined}
            onClick={() => setActive(j.id)}
          >
            <NavIcon name={j.icon} size={18} />{j.label}
          </a>
        ))}
      </nav>

      <div className="es-pb__grid">
        <div className="fx-stack fx-min0">
          <div id="pb-appearance" className="es-pb__pair es-pb__anchor">
            <CoverUpload event={event} onChanged={ctx.refresh} />
            <LogoCard event={event} onChanged={ctx.refresh} />
          </div>
          <HighlightsCard event={event} onChanged={ctx.refresh} />

          <div id="pb-content" className="es-pb__pair es-pb__pair--even es-pb__anchor">
            <MapPinCard event={event} onChanged={ctx.refresh} />
            <GalleryEditor eventId={eventId} section={media} />
          </div>

          <div id="pb-experience" className="fx-stack es-pb__anchor">
            <ScheduleEditor timezone={event.timezone} section={schedule} />
            <SponsorsEditor eventId={eventId} section={sponsors} />
          </div>

          <div id="pb-info" className="fx-stack es-pb__anchor">
            {/* A listing has no checkout, so its policies say nothing about one. */}
            <PoliciesEditor eventId={eventId} listing={event.listingType === 'display_only'} />
            {/* Event details, not the overview: the form left the overview for
                its own build step, and this line still sent people there. */}
            <p className="text-sm text-subtle">
              The description, venue and dates are in{' '}
              <Link href={`/organizer/events/${eventId}/details`} className="text-accent">Event details</Link>.
            </p>
          </div>

          <div className="es-dcard es-pb__bar">
            <span className="es-dform__saved es-pb__note">
              <NavIcon name="check" size={16} />
              Cover, logo, highlights and the pin save instantly.
            </span>
            {publicUrl ? (
              <a href={publicUrl} target="_blank" rel="noreferrer" className="es-btn es-btn--secondary">
                <NavIcon name="external" size={18} />Preview page<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="es-btn es-btn--secondary" aria-disabled="true" title="The public page opens once the event is on sale.">
                <NavIcon name="external" size={18} />Preview page
              </span>
            )}
            <button type="button" className="es-btn es-btn--primary" onClick={saveAll} disabled={saving || !runSave}>
              <NavIcon name="tick" size={18} />{saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>

        <aside className="es-pb__side">
          <LivePreview event={event} media={media.items} schedule={schedule.items} sponsors={sponsors.items} publicUrl={publicUrl} />
        </aside>
      </div>
    </div>
  );
}
