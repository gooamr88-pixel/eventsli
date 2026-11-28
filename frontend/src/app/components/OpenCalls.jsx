import Link from 'next/link';
import NavIcon from './shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Become a sponsor" · "Become a vendor" under an event card (owner,
 * 2026-11-28: "if the organizer enables visitors to become vendors or
 * sponsors in his event, show professional badges with links under the card
 * on the main page and the events page").
 *
 * The API says which (`openCalls` on every listing): exactly when the
 * organizer's sponsorship or vendor programme is open, never on a finished
 * or private event. Each badge links to that event's own page for it — the
 * same pages the event page's "Become a sponsor / vendor" buttons open.
 *
 * Rendered BESIDE the card's link, never inside it: the card is one <a>,
 * and an <a> inside an <a> is invalid HTML.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The badges an event offers, in order: sponsors first. */
export function openCallLinks(event) {
  const calls = event?.openCalls;
  if (!calls || !event.slug || event.isPast || event.isPrivate) return [];
  const out = [];
  if (calls.sponsors) out.push({ kind: 'sponsor', href: `/e/${event.slug}/sponsor`, label: 'Become a sponsor', icon: 'handshake' });
  if (calls.vendors) out.push({ kind: 'vendor', href: `/e/${event.slug}/vendors`, label: 'Become a vendor', icon: 'store' });
  return out;
}

export default function OpenCalls({ event }) {
  const links = openCallLinks(event);
  if (!links.length) return null;
  return (
    <nav className="es-opencalls" aria-label={`Partner with ${event.title}`}>
      {links.map((l) => (
        <Link key={l.kind} href={l.href} className={`es-opencall es-opencall--${l.kind}`}>
          <span className="es-opencall__coin" aria-hidden="true"><NavIcon name={l.icon} size={15} /></span>
          <span className="es-opencall__label">{l.label}</span>
          <NavIcon name="arrowUpRight" size={14} className="es-opencall__go" />
        </Link>
      ))}
    </nav>
  );
}
