'use client';

import Link from 'next/link';
import { useApi } from '../../../hooks/useApi';
import { useOrganizer } from '../../../hooks/useOrganizer';
import { Panel } from '../../../components/ui/Page';
import NavIcon from '../../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "What is left before this goes on sale" — for an event that is not on sale.
 *
 * `useLaunchSteps` is the one place the steps are worked out, so the checklist,
 * the "next step" card at the top of the page and the Submit button can never
 * disagree about what is done. Every item is read from real state — ticket
 * types and seats from `/events/:id/stats`, payments from the organizer — never
 * from a flag this page keeps for itself.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useLaunchSteps(event) {
  const { organizer } = useOrganizer();
  const { data: stats } = useApi(`/events/${event.id}/stats?days=7`);
  const base = `/organizer/events/${event.id}`;
  const submitted = ['pending_review', 'published'].includes(event.status);
  const choosesPayment = event.payments?.acceptsStripe || event.payments?.acceptsManual;

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT THIS EVENT ACTUALLY NEEDS, from the server.
   *
   * `event.needs` is computed by `eventRules.eventNeeds` and carried on the
   * event. It is not re-derived here, and that is the point: this checklist,
   * the sidebar, the submit button and the API's own refusals all branch on the
   * same question, and when they answer it separately they drift. The shape
   * that takes is a checklist demanding a step the sidebar does not offer,
   * which an organizer cannot resolve from the outside.
   *
   * The fallback covers the moment before the event has loaded, and an older
   * API that does not send it yet. It deliberately errs toward SHOWING a step:
   * a checklist that omits something required is worse than one that lists
   * something already handled, because the first is silent.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const ticketed = event.listingType !== 'display_only';
  const needs = event.needs || {
    tickets: ticketed,
    seating: ticketed && event.admissionType !== 'general',
    payment: ticketed,
  };

  const items = [
    {
      key: 'details',
      label: 'Event details',
      // A title and dates exist on every event; a venue is what is usually missing.
      done: Boolean(event.title && event.startsAt && event.venue?.name),
      href: `${base}#details`,
      hint: 'Add the venue so buyers know where to go',
      cta: 'Add the venue',
    },
    {
      key: 'cover', label: 'Cover image', done: Boolean(event.cover), href: `${base}/content`,
      hint: 'Recommended — it is the picture on every share', cta: 'Add a cover', optional: true,
    },
    {
      key: 'content',
      label: 'Page & branding',
      // "Done" the moment there is anything beyond a cover. Not a bar to clear:
      // it is a prompt, and an organizer who has added one highlight has found
      // the screen, which is all this step is for.
      done: Boolean(
        event.logo
        || (event.highlights?.length || 0) > 0,
      ),
      href: `${base}/content`,
      hint: 'Photos, a schedule, sponsors and your policies — all optional',
      cta: 'Build the page',
      optional: true,
    },
    ...(needs.tickets ? [
      {
        key: 'tiers',
        label: 'Ticket types',
        done: (stats?.tiers?.length || 0) > 0,
        href: `${base}/tiers`,
        // The hint changes with the event, because on a general-admission event
        // the ticket type IS the stock — its quantity is the capacity — and an
        // organizer who leaves it unlimited has not made a mistake but should
        // know that is what they did.
        hint: needs.seating
          ? 'At least one ticket type and its price'
          : 'At least one ticket type, its price, and how many you are selling',
        cta: 'Add ticket types',
        build: true,
      },
    ] : []),

    /**
     * THE SEATING MAP, ONLY WHERE THERE IS ONE.
     *
     * This step used to be unconditional for every ticketed event, so somebody
     * running a conference or a club night had to draw a fictional seating plan
     * before they could sell anything — and until they did, their event sat at
     * "1 step remaining" forever.
     */
    ...(needs.seating ? [
      {
        key: 'map', label: 'Seating map', done: (stats?.seats?.total || 0) > 0, href: `${base}/map`,
        hint: 'The tables and seats you sell', cta: 'Build the seating map', build: true,
      },
    ] : []),

    /**
     * A PAYMENT METHOD, ONLY WHERE MONEY MOVES.
     *
     * `needs.payment` is false when every ticket type is free — derived from
     * the prices themselves, server-side, never from a flag. Sending somebody
     * running a free workshop to a Stripe onboarding form for money that will
     * never move is where they abandon the product, and the submit endpoint
     * applies exactly the same rule so the two cannot disagree.
     */
    ...(needs.payment ? [
      {
        key: 'payments',
        label: 'Payment method',
        // The same rule submit applies: switched on for this event AND set up.
        done: Boolean(organizer) && Boolean(
          (event.payments?.acceptsStripe && organizer.payments?.stripeReady)
          || (event.payments?.acceptsManual && organizer.payments?.manualMethods > 0),
        ),
        href: choosesPayment ? '/organizer/payments' : `${base}#details`,
        hint: choosesPayment ? 'Finish setting up the payment option this event uses' : 'Choose how buyers pay for this event',
        cta: choosesPayment ? 'Set up payments' : 'Choose payment',
        build: true,
      },
    ] : []),
    {
      key: 'terms', label: 'Accept the terms', done: Boolean(event.review?.termsAccepted), href: '#going-on-sale',
      hint: 'See the fees and agree to them', cta: 'Review the fees',
    },
    {
      key: 'submit', label: 'Submit for review', done: submitted, href: '#going-on-sale',
      hint: 'Eventsli checks it, usually within a day', cta: 'Submit for review',
    },
  ];

  const required = items.filter((i) => !i.optional);
  return {
    items,
    loaded: Boolean(stats) && Boolean(organizer),
    ready: required.filter((i) => i.done).length,
    total: required.length,
    // Everything that has to exist before Eventsli can review it.
    buildReady: items.filter((i) => i.build || i.key === 'details').every((i) => i.done),
    next: required.find((i) => !i.done) || null,
  };
}

export default function LaunchChecklist({ steps }) {
  const { items, ready, total, loaded } = steps;

  return (
    <Panel title="Before it goes on sale" description={loaded ? `${ready} of ${total} done` : 'Checking…'}>
      <progress className="es-progress" max={total} value={ready} aria-label={`${ready} of ${total} steps done`} />

      <ol className="fx-stack fx-stack--sm">
        {items.map((item) => (
          <li key={item.key} className="fx-row fx-row--between flex-nowrap gap-3 border-t border-border-base pt-3 first:border-0 first:pt-0">
            <span className="fx-row fx-min0 flex-1 flex-nowrap items-start gap-3">
              <span className={`mt-0.5 shrink-0 ${item.done ? 'text-accent' : 'text-subtle'}`}>
                <NavIcon name={item.done ? 'check' : 'info'} size={18} />
              </span>
              <span className="fx-min0 flex-1">
                <span className={`block ${item.done ? 'text-muted line-through decoration-1' : 'text-ink'}`}>
                  {item.label}
                  {item.optional && <span className="es-optional ml-2 no-underline">Optional</span>}
                </span>
                {!item.done && <span className="block text-sm text-muted">{item.hint}</span>}
              </span>
            </span>
            {item.done ? (
              <span className="es-pill es-pill--accent shrink-0">Done</span>
            ) : (
              <Link href={item.href} className="es-btn es-btn--ghost es-btn--sm shrink-0 text-accent">
                Start
                <span className="sr-only"> {item.label}</span>
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** The single next thing to do, as the first thing on the page. */
export function NextStep({ steps }) {
  const { next, loaded } = steps;
  if (!loaded || !next) return null;
  const inPage = next.href.startsWith('#');
  const Button = inPage ? 'a' : Link;
  return (
    <section className="es-nextstep" aria-label="Next step">
      <span className="es-nextstep__icon" aria-hidden="true"><NavIcon name="arrow" size={20} /></span>
      <div className="es-nextstep__body">
        <p className="es-nextstep__title">Next: {next.label.charAt(0).toLowerCase() + next.label.slice(1)}</p>
        <p className="es-nextstep__text">{next.hint}</p>
      </div>
      <Button href={next.href} className="es-btn es-btn--primary">{next.cta}</Button>
    </section>
  );
}
