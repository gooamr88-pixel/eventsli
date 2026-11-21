import Link from 'next/link';
import NavIcon from '../../components/shell/NavIcon';
import VendorShowcase from '../../components/vendors/booking/VendorShowcase';

/**
 * The event's vendors on its page (2026-11-20; the invitation rebuilt to the
 * owner's reference 2026-11-21).
 *
 * While the organizer takes vendors: "Innovate. Present. Connect." — their
 * photos and numbers, "Become a vendor" and "Reserve your booth". Booked
 * vendors follow as a row of small cards. Nothing at all when there are
 * neither. The full list, with descriptions and links, is on /e/<slug>/vendors.
 */
export default function EventVendorsSection({ vendors = [], slug, open = false, showcase = null, coverUrl = null }) {
  if (vendors.length === 0 && !open) return null;
  const shown = vendors.slice(0, 12);
  const instant = showcase?.bookingMode === 'instant';
  return (
    <section id="event-vendors" className="es-evvd" aria-labelledby={open ? 'event-vendors-show' : 'event-vendors-title'}>
      {open ? (
        <VendorShowcase
          id="event-vendors-show"
          headline={showcase?.headline}
          intro={showcase?.intro}
          photos={showcase?.photos?.length ? showcase.photos : [coverUrl].filter(Boolean)}
          highlights={showcase?.highlights || []}
          secondary={{ href: `/e/${slug}/vendors`, label: 'Become a vendor' }}
          primary={{ href: `/e/${slug}/vendors#booths`, label: instant ? 'Reserve your booth' : 'Apply for a booth' }}
        />
      ) : (
        <div className="es-evsp__head">
          <h2 id="event-vendors-title" className="es-evsp__title">Event <span className="es-lp-accent">vendors</span></h2>
          <p className="es-evsp__lede">Food, drinks and stalls you will find on the day.</p>
        </div>
      )}
      {shown.length > 0 && (
        <>
          {open && <h3 className="es-evvd__subtitle">Vendors already booked</h3>}
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
          <div className="es-evvd__actions">
            <Link href={`/e/${slug}/vendors#vendor-list`} className="es-btn es-btn--ghost">All vendors<NavIcon name="arrow" size={16} /></Link>
          </div>
        </>
      )}
    </section>
  );
}
