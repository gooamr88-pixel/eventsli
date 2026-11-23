'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '../../../../../utils/money';
import NavIcon from '../../../../../components/shell/NavIcon';
import FormError from '../../../../../components/forms/FormError';
import FloorPlanViewer from '../../../../../components/vendors/floorPlan/FloorPlanViewer';
import { useStartBooking } from '../../../../../components/vendors/booking/useStartBooking';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The booth page (owner's reference, 2026-11-21).
 *
 *   ┌ Booth name ─────────────────┐  ┌──────────────┐
 *   │ name · price · event        │  │    photo     │
 *   ├ Description ────────────────┤  │              │
 *   │ ☑ what is included …        │  └──────────────┘
 *   Booth Services
 *   Add-On Service   ① Booth Add-Ons ……… ② Marketing Add-Ons
 *   ☐ Rent extra chair                              CA$5
 *   ─────────────────────────────── Total Price: CA$5,005
 *   ← Back                          [ Reserve now ]
 *
 * The reference's "Add to Cart" is left out: the ticket cart holds tickets,
 * and a booth held in a cart for a day would keep it from other vendors.
 *
 * The total here is a preview in whole cents. The booking is priced again on
 * the server from the database when it starts — that number is the one paid.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function BoothDetail({ event, booth, addons, mode, open, holdMinutes, floorPlan, spots, initialSpot = null }) {
  const instant = mode === 'instant';
  const kinds = useMemo(() => [
    { key: 'booth', label: 'Booth Add-Ons', items: addons.filter((a) => a.kind === 'booth') },
    { key: 'marketing', label: 'Marketing Add-Ons', items: addons.filter((a) => a.kind === 'marketing') },
  ].filter((k) => k.items.length), [addons]);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState(() => new Set());
  // Arriving from a tap on the floor plan (?spot=…), that booth is already chosen.
  const [spot, setSpot] = useState(initialSpot);
  const { start, busy, error } = useStartBooking(event.slug);

  const chosen = addons.filter((a) => picked.has(a.id));
  const total = booth.priceCents + chosen.reduce((s, a) => s + a.priceCents, 0);
  const toggle = (id) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const money = (c) => (c === 0 ? 'Free' : formatMoney(c, event.currency));
  const canBook = open && !booth.soldOut;
  const current = kinds[Math.min(step, kinds.length - 1)];

  return (
    <main className="es-vb-page fx-container fx-container--lg">
      <nav aria-label="Breadcrumb" className="es-co__crumbs">
        <Link href="/events">Events</Link>
        <span aria-hidden>/</span>
        <Link href={`/e/${event.slug}`} className="fx-truncate">{event.title}</Link>
        <span aria-hidden>/</span>
        <Link href={`/e/${event.slug}/vendors#booths`}>Booths</Link>
        <span aria-hidden>/</span>
        <span aria-current="page" className="es-co__crumbs-here fx-truncate">{booth.name}</span>
      </nav>

      <div className="es-vb-detail">
        <div className="es-vb-detail__text">
          <section className="es-vb-card" aria-labelledby="vb-booth-name">
            <h1 id="vb-booth-name" className="es-vb-card__title fx-break">{booth.name}</h1>
            <p className="es-vb-card__lede">
              {booth.name} <b className="es-nums">{money(booth.priceCents)}</b> in {event.title}
            </p>
            <p className="es-vb-detail__facts">
              {booth.sizeLabel && <span><NavIcon name="grid" size={16} />{booth.sizeLabel}</span>}
              <span><NavIcon name="users" size={16} />{booth.staffPasses} staff {booth.staffPasses === 1 ? 'pass' : 'passes'}</span>
              {booth.soldOut
                ? <span className="es-pill">Fully booked</span>
                : booth.remaining !== null && <span className={`es-pill ${booth.remaining <= 3 ? 'es-pill--warning' : ''}`}>{booth.remaining} left</span>}
            </p>
          </section>

          {(booth.description || booth.includes.length > 0) && (
            <section className="es-vb-card" aria-labelledby="vb-booth-desc">
              <h2 id="vb-booth-desc" className="es-vb-card__title">Description</h2>
              {booth.description && <p className="es-vb-card__body fx-break">{booth.description}</p>}
              {booth.includes.length > 0 && (
                <ul className="es-vb-checks">
                  {booth.includes.map((x) => (
                    <li key={x}><span className="es-vb-checks__box" aria-hidden="true"><NavIcon name="tick" size={14} /></span>{x}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <div className="es-vb-detail__media">
          {booth.imageUrl
            // eslint-disable-next-line @next/next/no-img-element -- the booth's photo, from storage
            ? <img src={booth.imageUrl} alt={`${booth.name} at ${event.title}`} />
            : event.coverUrl
              // eslint-disable-next-line @next/next/no-img-element -- the event's poster, from storage
              ? <img src={event.coverUrl} alt={event.title} />
              : <span className="es-vb-detail__placeholder" aria-hidden="true"><NavIcon name="store" size={72} /></span>}
        </div>
      </div>

      {floorPlan && canBook && (
        <section className="es-vb-section" aria-labelledby="vb-spot">
          <div className="es-vb-section__head">
            <h2 id="vb-spot" className="es-vb-h2">Choose your spot <span className="es-optional">Optional</span></h2>
            <p className="es-vb-sub">
              {spot ? 'Spot chosen — tap another to change it.' : 'Tap a free booth of this kind on the floor plan, or leave it to the organizer.'}
            </p>
          </div>
          <FloorPlanViewer
            floorPlan={floorPlan}
            currency={event.currency}
            title={`${event.title} floor plan`}
            pickable
            // The viewer hands over the BOOTH and its state (FloorPlanViewer's
            // `canPick(e, state)` / `onPick(e)`). These took a booth id and
            // compared the whole booth with a list of ids, which never
            // matched — every spot said "This booth cannot be chosen".
            canPick={(e, state) => spots.includes(e.id) && (state?.status || 'available') === 'available'}
            onPick={(e) => setSpot((s) => (s === e.id ? null : e.id))}
            pickedKey={spot}
          />
        </section>
      )}

      {kinds.length > 0 && (
        <section className="es-vb-services" aria-labelledby="vb-services">
          <h2 id="vb-services" className="es-vb-services__title">Booth Services</h2>
          <div className="es-vb-services__head">
            <h3 className="es-vb-services__h3">Add-On Service</h3>
            <p className="es-vb-sub">Add a little magic! Every extra choice makes your booth work harder.</p>
          </div>

          {kinds.length > 1 && (
            <ol className="es-vb-steps" aria-label="Add-on steps">
              {kinds.map((k, i) => (
                <li key={k.key}>
                  <button type="button" className="es-vb-steps__step" aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)}>
                    <span className="es-vb-steps__num es-nums" aria-hidden="true">{i + 1}</span>
                    {k.label}
                    {k.items.some((a) => picked.has(a.id)) && <span className="sr-only"> (some chosen)</span>}
                  </button>
                </li>
              ))}
            </ol>
          )}

          <fieldset className="es-vb-addons">
            <legend className="sr-only">{current.label}</legend>
            {current.items.map((a) => (
              <label key={a.id} className={`es-vb-addon ${picked.has(a.id) ? 'is-on' : ''}`}>
                <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} disabled={!canBook} />
                <span className="es-vb-addon__text fx-min0">
                  <span className="es-vb-addon__name fx-break">{a.name}</span>
                  {a.description && <span className="es-vb-addon__desc fx-break">{a.description}</span>}
                </span>
                <span className="es-vb-addon__price es-nums">{money(a.priceCents)}</span>
              </label>
            ))}
            {kinds.length > 1 && (
              <div className="es-vb-addons__nav">
                {step > 0 && <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setStep(step - 1)}><NavIcon name="chevronLeft" size={16} />{kinds[step - 1].label}</button>}
                {step < kinds.length - 1 && <button type="button" className="es-btn es-btn--secondary es-btn--sm ml-auto" onClick={() => setStep(step + 1)}>Next: {kinds[step + 1].label}<NavIcon name="chevronRight" size={16} /></button>}
              </div>
            )}
          </fieldset>
          <p className="es-vb-note"><NavIcon name="info" size={16} />Add-ons are provided by {event.organizerName || 'the organizer'}, who is responsible for delivering them.</p>
        </section>
      )}

      <div className="es-vb-total">
        <p className="es-vb-total__row">
          <span>Total Price:</span>
          <b className="es-nums">{money(total)}</b>
        </p>
        {chosen.length > 0 && <p className="es-vb-total__breakdown">Booth {money(booth.priceCents)} + {chosen.length} add-on{chosen.length === 1 ? '' : 's'}</p>}
      </div>

      <div className="es-vb-actions">
        <Link href={`/e/${event.slug}/vendors#booths`} className="es-vb-back"><NavIcon name="arrow" size={18} />Back</Link>
        <div className="es-vb-actions__go">
          <FormError error={error} />
          {canBook ? (
            <button type="button" className="es-vb-btn es-vb-btn--sun" disabled={busy} aria-busy={busy || undefined}
              onClick={() => start({ boothTypeId: booth.id, boothKey: spot, addonIds: [...picked] })}>
              <NavIcon name={instant ? 'card' : 'send'} size={20} />
              {busy ? 'One moment…' : instant ? 'Reserve now' : 'Apply for this booth'}
            </button>
          ) : (
            <span className="es-pill">{booth.soldOut ? 'Fully booked' : instant ? 'Booking closed' : 'Applications closed'}</span>
          )}
          {canBook && (
            <p className="es-vb-hint">
              {instant
                ? `We hold this booth for you for ${holdMinutes} minutes while you add your business details.`
                : 'Next: your business details. Nothing is charged — the organizer replies to your application.'}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
