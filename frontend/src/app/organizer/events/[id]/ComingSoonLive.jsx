'use client';

import Link from 'next/link';
import NavIcon from '../../../components/shell/NavIcon';
import { Notice } from '../../../components/Feedback';
import LaunchChecklist, { useLaunchSteps, NextStep } from './LaunchChecklist';
import ReviewActions from './ReviewActions';
import { formatYm } from '../../../lib/comingSoon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A LIVE "COMING SOON" EVENT — what is waiting, and what is left before
 * ticket sales open (owner, 2026-11-17).
 *
 * The teaser is public with a "Notify me" box. This says how many people have
 * asked to be told (a count; the addresses are theirs), then the same
 * checklist and confirm a new event goes through — ending in "Open ticket
 * sales" instead of Publish. The checks behind it are the normal publish
 * checks (backend submissionService.launchBlockers).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ComingSoonLive({ event, onChanged }) {
  const steps = useLaunchSteps(event);
  const waiting = event.notifyCount;
  const declined = event.review?.rejectionReason && !event.launchRequestedAt;

  return (
    <>
      <section className="es-card fx-stack fx-stack--sm p-5" aria-label="Coming soon">
        <div className="fx-row fx-row--between items-start gap-3">
          <div className="fx-min0 flex-1">
            <p className="es-eyebrow">Coming soon · live</p>
            <h2 className="es-panel-head__title">
              {typeof waiting === 'number'
                ? `${waiting.toLocaleString()} ${waiting === 1 ? 'person is' : 'people are'} waiting for tickets`
                : 'People can ask to hear when tickets go on sale'}
            </h2>
            <p className="text-sm text-muted">
              Your page shows {event.roughMonth ? `“Coming soon · ${formatYm(event.roughMonth)}”` : '“Coming soon”'} with
              a “Notify me” button. Everyone who leaves their email is told the moment you open ticket sales.
            </p>
          </div>
          <span className="es-ovcard__glyph shrink-0" aria-hidden="true"><NavIcon name="bell" size={24} /></span>
        </div>
        <div className="fx-row">
          <a href={`/e/${event.slug}`} target="_blank" rel="noreferrer" className="es-btn es-btn--secondary es-btn--sm">
            <NavIcon name="external" size={16} />See the page<span className="sr-only"> (opens in a new tab)</span>
          </a>
          <Link href={`/organizer/events/${event.id}/share`} className="es-btn es-btn--ghost es-btn--sm">
            <NavIcon name="share" size={16} />Share it
          </Link>
        </div>
      </section>

      {declined && (
        <Notice tone="warning" title="Eventsli asked for changes before ticket sales open">
          <p className="fx-break">{event.review.rejectionReason}</p>
          <p>Your coming-soon page is still live. Make the change, then open ticket sales again.</p>
        </Notice>
      )}

      <NextStep steps={steps} />
      <div className="es-split es-split--even">
        <LaunchChecklist steps={steps} title="Before ticket sales open" />
        <div id="going-on-sale" className="scroll-mt-24">
          <ReviewActions event={event} onChanged={onChanged} buildReady={steps.loaded ? steps.buildReady : true} />
        </div>
      </div>
    </>
  );
}
