'use client';

import { useState } from 'react';
import Link from 'next/link';
import NavIcon from '../../../../components/shell/NavIcon';
import MoreActions, { MoreItem } from '../../../../components/ui/MoreActions';
import { PARTNER_KINDS, usePartnerSwitch } from '../PartnersCard';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE SPONSORS AND VENDORS BOTH HAVE NOW (owner, 2026-11-23: "a hardship
 * journey … especially sponsors and vendors").
 *
 * Both used to open on the END of their process: a board of five or six empty
 * columns ("Nothing here") under four money tiles and a legal notice, with the
 * steps an organizer actually starts with — what you sell, your public page —
 * hidden in later tabs. Now each opens on:
 *
 *   SetupGuide   three numbered steps, the next one highlighted, each with
 *                the button that does it. Gone once all three are done.
 *   PartnerList  every sponsor / vendor as one plain row, with filter chips
 *                (All · New · … ) instead of columns.
 *
 * and everything else (packages, booth types, page settings) sits in tabs
 * behind it. `PartnerOff` is the screen for an event that has not turned the
 * feature on — reached by an old link or a bookmark.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * `steps`: [{ key, title, text, done, action: { label, onClick } | { label, href } }].
 * The first step not done is the current one.
 */
export function SetupGuide({ title, steps }) {
  const current = steps.findIndex((s) => !s.done);
  if (current < 0) return null;
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <section className="es-card es-panel" aria-labelledby="partner-setup">
      <div className="es-panel-head">
        <div className="fx-min0">
          <h2 id="partner-setup" className="es-panel-head__title">{title}</h2>
          <p className="es-panel-head__desc">{doneCount} of {steps.length} done</p>
        </div>
      </div>
      <ol className="es-setup">
        {steps.map((step, i) => {
          const state = step.done ? 'done' : i === current ? 'current' : 'upcoming';
          return (
            <li key={step.key} className="es-setup__step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="es-setup__num" aria-hidden="true">
                {step.done ? <NavIcon name="check" size={16} /> : i + 1}
              </span>
              <div className="fx-min0">
                <h3 className="es-setup__title">
                  {step.title}
                  {step.done && <span className="sr-only"> (done)</span>}
                </h3>
                <p className="es-setup__text">{step.text}</p>
                {step.action && !step.done && (
                  <div className="es-setup__act">
                    {step.action.href ? (
                      <Link href={step.action.href} className={`es-btn ${state === 'current' ? 'es-btn--primary' : 'es-btn--secondary'} es-btn--sm`}>
                        {step.action.label}
                      </Link>
                    ) : (
                      <button type="button" onClick={step.action.onClick} className={`es-btn ${state === 'current' ? 'es-btn--primary' : 'es-btn--secondary'} es-btn--sm`}>
                        {step.action.label}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * `filters`: [{ key, label }] — the backend's board columns, relabelled.
 * `rows`: [{ id, column, href, logoUrl, name, sub, end }], `end` being what
 * sits on the right (status, amount).
 */
export function PartnerList({ label, filters, rows, empty }) {
  const [filter, setFilter] = useState('all');
  const counts = Object.fromEntries(filters.map((f) => [f.key, rows.filter((r) => r.column === f.key).length]));
  const shown = filter === 'all' ? rows : rows.filter((r) => r.column === filter);

  if (rows.length === 0) return empty || null;

  return (
    <div className="fx-stack fx-stack--sm">
      <div role="group" aria-label={`Filter ${label}`} className="es-segmented">
        <button type="button" className="es-segmented__option" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All <span className="es-segmented__count">{rows.length}</span>
        </button>
        {filters.filter((f) => counts[f.key] > 0 || filter === f.key).map((f) => (
          <button key={f.key} type="button" className="es-segmented__option" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label} <span className="es-segmented__count">{counts[f.key]}</span>
          </button>
        ))}
      </div>
      <ul className="es-plist" aria-label={label}>
        {shown.map((r) => (
          <li key={r.id}>
            <Link href={r.href} className="es-plist__row">
              {r.logoUrl
                // eslint-disable-next-line @next/next/no-img-element -- the partner's own logo, from storage
                ? <img src={r.logoUrl} alt="" className="es-plist__logo" />
                : <span className="es-plist__initial" aria-hidden="true">{String(r.name || '?').slice(0, 1).toUpperCase()}</span>}
              <span className="fx-min0">
                <span className="es-plist__name fx-break">{r.name}</span>
                {r.sub && <span className="es-plist__sub">{r.sub}</span>}
              </span>
              <span className="es-plist__end">{r.end}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Header actions: the public page when open, and "Turn off" in a menu. */
export function PartnerActions({ eventId, kind, publicHref }) {
  const { turnOff } = usePartnerSwitch(eventId);
  return (
    <div className="fx-row gap-2">
      {publicHref && (
        <a className="es-btn es-btn--secondary" href={publicHref} target="_blank" rel="noreferrer">
          <NavIcon name="external" size={18} />Public page<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
      <MoreActions compact align="end" srLabel={`More ${PARTNER_KINDS[kind].label.toLowerCase()} actions`}>
        <MoreItem icon="close" onClick={() => turnOff(kind)}>{PARTNER_KINDS[kind].offLabel}</MoreItem>
      </MoreActions>
    </div>
  );
}

/** An event that has not turned this on: say what it is, and offer it. */
export function PartnerOff({ eventId, kind }) {
  const { turnOn, busy } = usePartnerSwitch(eventId);
  const k = PARTNER_KINDS[kind];
  return (
    <div className="es-sp-empty">
      <NavIcon name={k.icon} size={36} />
      <p className="es-sp-empty__title">{k.label} are off for this event</p>
      <p className="text-sm text-muted">{k.pitch}</p>
      <div className="fx-row gap-2">
        <button type="button" className="es-btn es-btn--primary" disabled={busy === kind} onClick={() => turnOn(kind, { go: false })}>
          <NavIcon name="plus" size={18} />{busy === kind ? 'Turning on…' : `Add ${k.label.toLowerCase()} to this event`}
        </button>
        <Link href={`/organizer/events/${eventId}`} className="es-btn es-btn--ghost">Back to overview</Link>
      </div>
    </div>
  );
}

/** The "you deliver what you sell" notice, folded down to one line. */
export function DutyNote({ title, children }) {
  return (
    <details className="es-partner-more">
      <summary><NavIcon name="info" size={16} /> {title}</summary>
      <p className="mt-2 text-sm text-muted">{children}</p>
    </details>
  );
}
