import Link from 'next/link';
import NavIcon from '../../components/shell/NavIcon';

/**
 * The event's vendors on its page (2026-11-20): booked vendors as a row of
 * small cards, and "Become a vendor" while the organizer's vendor page is on.
 * Nothing at all when there are neither. The full list, with descriptions and
 * links, is on /e/<slug>/vendors.
 */
export default function EventVendorsSection({ vendors = [], slug, open = false }) {
  if (vendors.length === 0 && !open) return null;
  const shown = vendors.slice(0, 12);
  return (
    <section id="event-vendors" className="es-evvd" aria-labelledby="event-vendors-title">
      <div className="es-evsp__head">
        <h2 id="event-vendors-title" className="es-evsp__title">Event <span className="es-lp-accent">vendors</span></h2>
        <p className="es-evsp__lede">{vendors.length ? 'Food, drinks and stalls you will find on the day.' : 'This event is taking vendor applications.'}</p>
      </div>
      {shown.length > 0 && (
        <ul className="es-evvd__grid">
          {shown.map((v) => (
            <li key={v.id} className="es-evvd__item">
              {v.logoUrl
                // eslint-disable-next-line @next/next/no-img-element -- a vendor's logo, from storage
                ? <img src={v.logoUrl} alt="" className="es-evvd__logo" />
                : <span className="es-evvd__initial" aria-hidden="true">{v.name.slice(0, 1).toUpperCase()}</span>}
              <span className="fx-min0">
                <span className="es-evvd__name fx-break">{v.name}</span>
                <span className="es-evvd__meta">{[v.category, v.booth ? `Booth ${v.booth}` : null].filter(Boolean).join(' · ')}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="es-evvd__actions">
        {vendors.length > 0 && <Link href={`/e/${slug}/vendors#vendor-list`} className="es-btn es-btn--ghost">All vendors<NavIcon name="arrow" size={16} /></Link>}
        {open && <Link href={`/e/${slug}/vendors`} className="es-btn es-btn--secondary"><NavIcon name="store" size={18} />Become a vendor</Link>}
      </div>
    </section>
  );
}
