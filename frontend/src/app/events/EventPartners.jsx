/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The sponsors and vendors of one event, at the foot of its /events card
 * (owner, 2026-11-28: "display event vendors and sponsors directly beneath
 * their event cards").
 *
 * The API sends each card's first few (headline sponsors first) and the
 * totals (`partners` on GET /public/events?withPartners=true). Each row is a
 * small overlapping stack of logos — a monogram when a brand has no logo —
 * then the names and "+N". A headline sponsor turns the label into
 * "Presented by". Nothing here is a link: the whole card is one already.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const LOGOS = 4;
const NAMES = 2;

/** "Headline Bank", "Partner Co" → "HB", "PC". */
export function monogram(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[1][0]}`).toUpperCase();
}

/** One row's words and logos, or null when there is nobody to show. */
export function partnerRow(items, total, kind) {
  const list = Array.isArray(items) ? items.filter((x) => x && x.name) : [];
  const count = Math.max(Number(total) || 0, list.length);
  if (!count) return null;
  const presented = kind === 'sponsor' && list[0]?.level === 'headline';
  const names = list.slice(0, NAMES).map((x) => x.name);
  return {
    kind,
    label: presented ? 'Presented by' : kind === 'sponsor' ? (count === 1 ? 'Sponsor' : 'Sponsors') : (count === 1 ? 'Vendor' : 'Vendors'),
    logos: list.slice(0, LOGOS),
    names: names.join(', '),
    more: count - names.length,
    count,
  };
}

/** Both rows for a card, or null when the event has neither. */
export function partnerRows(partners) {
  if (!partners) return null;
  const rows = [
    partnerRow(partners.sponsors, partners.sponsorCount, 'sponsor'),
    partnerRow(partners.vendors, partners.vendorCount, 'vendor'),
  ].filter(Boolean);
  return rows.length ? rows : null;
}

function Logo({ item, kind }) {
  return (
    <span className={`es-evx-partners__logo es-evx-partners__logo--${kind}`} title={item.name}>
      {item.logoUrl ? (
        // A plain <img>: sponsor and vendor logos are the organizer's storage
        // objects, already sized at upload, lazily loaded below the fold.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.logoUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <span aria-hidden="true">{monogram(item.name)}</span>
      )}
    </span>
  );
}

export default function EventPartners({ partners }) {
  const rows = partnerRows(partners);
  if (!rows) return null;
  return (
    <div className="es-evx-partners">
      {rows.map((row) => (
        <div key={row.kind} className={`es-evx-partners__row es-evx-partners__row--${row.kind}`}>
          <span className="es-evx-partners__label">{row.label}</span>
          <span className="es-evx-partners__stack" aria-hidden="true">
            {row.logos.map((item, i) => <Logo key={`${item.name}-${i}`} item={item} kind={row.kind} />)}
          </span>
          <span className="es-evx-partners__names">
            {row.names}
            {row.more > 0 && <span className="es-evx-partners__more"> +{row.more}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
