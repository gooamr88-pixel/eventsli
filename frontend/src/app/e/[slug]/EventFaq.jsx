import { quickAnswers } from '../../lib/eventSeo';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Frequently asked questions (owner's reference, 2026-11-15).
 *
 * A centred heading, one line under it, then an accordion: a pale band per
 * question with a "+" that turns into a "×" when it is open. The organizer's
 * own questions come first (the event's policies: "Are children allowed?",
 * "Can I bring a camera?"), then the plain "when / where / how much" answers
 * every event has, so the section is never empty.
 *
 * `<details>`, so it costs no JavaScript, opens with the keyboard, and every
 * answer is in the HTML for a crawler — the answers are the page's best
 * search content. `#event-faq` is the anchor the header's "Refund policy"
 * link lands on.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function EventFaq({ event }) {
  const items = [
    ...(event.policies || []).map((p) => ({ key: `p-${p.id}`, q: p.title, a: p.body })),
    ...quickAnswers(event).map(({ q, a }) => ({ key: `q-${q}`, q, a })),
  ].filter((i) => i.q && i.a);
  if (items.length === 0) return null;

  return (
    <section id="event-faq" className="es-evx-faq" aria-labelledby="event-faq-title">
      <h2 id="event-faq-title" className="es-evx-faq__title">
        Frequently asked <span className="es-lp-accent">questions</span>
      </h2>
      <p className="es-evx-faq__lede">Here are the questions guests most often ask about this event.</p>
      <div className="es-evx-faq__list">
        {items.map((item) => (
          <details key={item.key} className="es-evx-faq__item">
            <summary className="es-evx-faq__q">
              <span aria-hidden className="es-evx-faq__plus" />
              <span className="fx-min0 fx-break">{item.q}</span>
            </summary>
            <div className="es-evx-faq__a fx-break">{item.a}</div>
          </details>
        ))}
      </div>
      {(event.policies || []).length > 0 && (
        <p className="es-evx-faq__note">
          Set by the organizer for this event. Eventsli&apos;s own terms apply to every purchase.
        </p>
      )}
    </section>
  );
}
