'use client';

import { useState } from 'react';
import Link from 'next/link';
import NavIcon from '../../../components/shell/NavIcon';
import { organizerNavGroups } from '../../nav/organizerNav';
import { useEventContext } from './EventContext';
import { useRunStepSave } from './BuildStep';
import { usePathname, useRouter } from 'next/navigation';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "DONE HERE — WHAT NEXT?" at the foot of every build screen.
 *
 * The creation wizard ends the moment the event row exists, and everything that
 * makes it sellable — ticket types, the seat map, the page, the discounts — is
 * a separate screen reached from the launch checklist. Each of those screens
 * was a dead end: it saved, and then offered nothing. To do the next thing you
 * had to know to go back to the overview and read the checklist again, which
 * is a step the wizard had spent five screens teaching you not to need.
 *
 * So each build screen now ends the way the wizard's steps did: with the way
 * back and the way on.
 *
 * ONLY THE BUILD GROUP, and this is the fix rather than a restriction. The
 * sequence used to run through Sell and On the day as well, so "Next" walked an
 * organizer from Discounts into Share, Orders, Door sales, Commission, the door
 * list, the door team and the scanning devices — eight screens that are not
 * setup steps and are all empty before a single ticket has sold — under a bar
 * announced as "Event setup steps". Setting up an event is the six screens in
 * the build group, and it ends at Review & submit.
 *
 * THE ORDER IS THE SIDEBAR'S ORDER, from `organizerNavGroups`. That matters
 * more than it looks: a general-admission event has no seat map and no table
 * categories, so "next" after Ticket types is Page & branding, not a map that
 * does not exist. A hand-written order here would have to know that rule too,
 * and would be the copy that forgets it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/** The build sequence for this event, in the sidebar's order. Overview first. */
function buildSteps(eventId, event) {
  return organizerNavGroups({
    eventId,
    listingType: event.listingType || null,
    admissionType: event.admissionType || null,
  })
    .filter((g) => g.id === 'build')
    .flatMap((g) => g.items)
    .filter((item) => item.href);
}

const PRE_LAUNCH = ['draft', 'rejected', 'pending_review'];

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "SETUP · STEP 3 OF 6" — at the top of a build screen, before launch.
 *
 * The wizard counts its steps; the six screens after it did not. They ended in
 * Back / Save and continue at the very foot of each page, so on a phone the only
 * sign of a sequence was below several screens of form. This line is the top of
 * the same sequence `BuildNav` walks, from the same list, so the two cannot
 * disagree about which step this is.
 *
 * Only before the event is on sale. Afterwards these screens are places an
 * organizer returns to, not steps they are working through.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function BuildProgress() {
  const pathname = usePathname() || '';
  const { eventId, event } = useEventContext() || {};
  if (!eventId || !event || !PRE_LAUNCH.includes(event.status)) return null;

  // The overview is where the sequence is launched from, not one of its steps.
  const steps = buildSteps(eventId, event).filter((s) => s.key !== 'overview');
  const here = steps.findIndex((s) => s.href === pathname);
  if (here < 0) return null;

  return (
    <div className="es-buildstep">
      <p className="es-buildstep__text">
        <span className="text-subtle">Setup · step {here + 1} of {steps.length}</span>
        <span aria-hidden className="text-subtle"> · </span>
        <span className="text-ink">{steps[here].label}</span>
      </p>
      <span aria-hidden className="es-buildstep__bar">
        {steps.map((s, i) => (
          <span key={s.key} className="es-wizard__seg" data-state={i < here ? 'done' : i === here ? 'current' : 'upcoming'} />
        ))}
      </span>
    </div>
  );
}

export default function BuildNav() {
  const pathname = usePathname() || '';
  const router = useRouter();
  const runSave = useRunStepSave();
  const [saving, setSaving] = useState(false);
  const { eventId, event } = useEventContext() || {};

  // Nothing until the event has loaded: the steps depend on what KIND of event
  // it is, and guessing produces a bar that changes under the reader.
  if (!eventId || !event) return null;

  const steps = buildSteps(eventId, event);

  const here = steps.findIndex((s) => s.href === pathname);
  if (here < 0) return null;

  /**
   * NOT ON THE OVERVIEW. That screen already answers "what next" three times —
   * the Next step card at the top, the launch checklist under it, and the
   * submit step beside that — and it is the one screen that was never a dead
   * end. A fourth way on, at the bottom, is the clutter this bar exists to
   * remove everywhere else.
   */
  if (steps[here].key === 'overview') return null;

  const previous = steps[here - 1] || null;
  const next = steps[here + 1] || null;

  /**
   * THE LAST BUILD SCREEN LEADS TO SUBMITTING, not to nothing.
   *
   * Discounts is the end of the list, so it used to render a Back link and an
   * empty space — the same dead end this component exists to remove, moved to
   * the final screen. The way on from the last step is the review, which lives
   * on the overview under `#going-on-sale`.
   */
  const finish = !next && here > 0
    ? { href: `/organizer/events/${eventId}#going-on-sale`, label: 'Review & submit' }
    : null;
  const forward = next || finish;
  if (!previous && !forward) return null;

  /**
   * REAL BUTTONS (redesigned 2026-10-16, at the owner's request).
   *
   * These were two pale cards with a 12px monospaced caption — "SAVE AND
   * CONTINUE" in a tinted box read as a label, not as the thing to press, and
   * the step name was cut to "Table categor…" on a phone. Now the way on is the
   * page's one solid primary button, with what it leads to under it, and Back
   * is an outline button beside it (stacked full width on a phone, Back first
   * so the reading order and the tab order agree and the primary sits nearest
   * the thumb). Every build screen of both kinds of event uses this one bar.
   */
  return (
    <nav className="es-buildnav" aria-label="Event setup steps">
      {previous ? (
        <Link href={previous.href} className="es-buildnav__btn es-buildnav__btn--back">
          <span aria-hidden className="es-buildnav__icon es-buildnav__icon--back">
            <NavIcon name="arrow" size={18} />
          </span>
          <span className="es-buildnav__text">
            <span className="es-buildnav__main">Back</span>
            <span className="es-buildnav__sub fx-truncate">{previous.label}</span>
          </span>
        </Link>
      ) : <span aria-hidden />}

      {/**
        * A BUTTON, WHERE BACK IS A LINK, and the asymmetry is the meaning.
        *
        * Back only navigates, so it stays an anchor — middle-click and "open
        * in a new tab" work on it, which this codebase cares about. This one
        * performs an action first and navigates second; an anchor that must
        * `preventDefault` before it can do its job is a button wearing the
        * wrong element, and it would offer a new tab that silently skips the
        * save.
        */}
      {forward && (
        <button
          type="button"
          className="es-buildnav__btn es-buildnav__btn--next"
          // The double-submit guard: these save handlers are PATCHes, and a
          // second press mid-flight is a second write of the same form.
          disabled={saving}
          aria-busy={saving || undefined}
          onClick={async () => {
            setSaving(true);
            try {
              // Only moves on if the screen says it is safe to. A failed save
              // leaves the reader on their own form, with its own error.
              if (!runSave || await runSave()) router.push(forward.href);
            } finally {
              setSaving(false);
            }
          }}
        >
          <span className="es-buildnav__text">
            <span className="es-buildnav__main">
              {saving ? 'Saving…' : 'Save and continue'}
            </span>
            <span className="es-buildnav__sub fx-truncate">Next: {forward.label}</span>
          </span>
          <span aria-hidden className="es-buildnav__icon">
            {saving ? <span className="es-buildnav__spin" /> : <NavIcon name="arrow" size={18} />}
          </span>
        </button>
      )}
    </nav>
  );
}
