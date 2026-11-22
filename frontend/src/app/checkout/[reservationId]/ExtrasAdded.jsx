import Link from 'next/link';
import NavIcon from '../../components/shell/NavIcon';
import { formatMoney } from '../../utils/money';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHETHER THE BUYER ADDED EXTRAS (owner, 2026-11-22: "at checkout make the
 * buyer know if he added add-ons").
 *
 * Add-ons are chosen with the tickets, before checkout, so this card does not
 * sell them — it says plainly what happened:
 *
 *   · extras on the hold → "Extras added to your order", each with its
 *     quantity and price, and who delivers them;
 *   · none, on an event that offers some → "No extras added", with the way
 *     back to add them (the ticket list, or the seat map);
 *   · an event with no add-ons → nothing at all.
 *
 * Every figure is the quote's (`quote.addons`), formatted only.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ExtrasAdded({ quote, organizerName, backHref }) {
  const added = Array.isArray(quote.addons) ? quote.addons.filter((a) => a.quantity > 0) : [];
  const offered = Array.isArray(quote.addonsOffered) ? quote.addonsOffered : [];
  if (added.length === 0 && offered.length === 0) return null;

  if (added.length === 0) {
    return (
      <section className="es-co-extras es-co-extras--none" aria-labelledby="co-extras">
        <span className="es-co-extras__icon" aria-hidden="true"><NavIcon name="sparkle" size={20} /></span>
        <div className="fx-min0">
          <h2 id="co-extras" className="es-co-extras__title">No extras added</h2>
          <p className="es-co-extras__sub">
            This event offers {offered.length === 1 ? 'an extra' : `${offered.length} extras`} — {offered.slice(0, 2).map((a) => a.name).join(', ')}
            {offered.length > 2 ? ' and more' : ''}.
          </p>
        </div>
        {backHref && <Link href={backHref} className="es-co-extras__link">Add extras</Link>}
      </section>
    );
  }

  return (
    <section className="es-co-extras es-co-extras--added" aria-labelledby="co-extras">
      <div className="es-co-extras__head">
        <span className="es-co-extras__icon es-co-extras__icon--ok" aria-hidden="true"><NavIcon name="tick" size={18} /></span>
        <div className="fx-min0">
          <h2 id="co-extras" className="es-co-extras__title">Extras added to your order</h2>
          <p className="es-co-extras__sub">
            {added.reduce((n, a) => n + a.quantity, 0)} {added.reduce((n, a) => n + a.quantity, 0) === 1 ? 'extra' : 'extras'}, included in the total
          </p>
        </div>
        {backHref && <Link href={backHref} className="es-co-extras__link">Change</Link>}
      </div>
      <ul className="es-co-extras__list">
        {added.map((a) => (
          <li key={a.addonId}>
            <span className="fx-min0 fx-break"><b>{a.name}</b></span>
            <span className="es-nums">× {a.quantity}</span>
            <span className="es-nums es-co-extras__price">
              {Number(a.unitPriceCents) === 0 ? 'Free' : `${formatMoney(a.unitPriceCents, quote.currency)} each`}
            </span>
          </li>
        ))}
      </ul>
      <p className="es-co-extras__note">
        <NavIcon name="info" size={15} />
        <span>Provided at the event by {organizerName || 'the organizer'}, who alone is responsible for delivering them.</span>
      </p>
    </section>
  );
}
