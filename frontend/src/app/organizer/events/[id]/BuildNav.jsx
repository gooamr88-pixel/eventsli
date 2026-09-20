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
export default function BuildNav() {
  const pathname = usePathname() || '';
  const router = useRouter();
  const runSave = useRunStepSave();
  const [saving, setSaving] = useState(false);
  const { eventId, event } = useEventContext() || {};

  // Nothing until the event has loaded: the steps depend on what KIND of event
  // it is, and guessing produces a bar that changes under the reader.
  if (!eventId || !event) return null;

  const steps = organizerNavGroups({
    eventId,
    listingType: event.listingType || null,
    admissionType: event.admissionType || null,
  })
    .filter((g) => g.id === 'build')
    .flatMap((g) => g.items)
    .filter((item) => item.href);

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

  return (
    <nav className="es-buildnav" aria-label="Event setup steps">
      {previous ? (
        <Link href={previous.href} className="es-buildnav__back">
          <span aria-hidden className="es-buildnav__arrow es-buildnav__arrow--back">
            <NavIcon name="arrow" size={16} />
          </span>
          <span className="fx-min0">
            <span className="es-buildnav__label">Back</span>
            <span className="es-buildnav__name fx-truncate">{previous.label}</span>
          </span>
        </Link>
      ) : <span />}

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
          className="es-buildnav__next"
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
          <span className="fx-min0">
            <span className="es-buildnav__label">
              {saving ? 'Saving…' : 'Save and continue'}
            </span>
            <span className="es-buildnav__name fx-truncate">{forward.label}</span>
          </span>
          <span aria-hidden className="es-buildnav__arrow"><NavIcon name="arrow" size={16} /></span>
        </button>
      )}
    </nav>
  );
}
