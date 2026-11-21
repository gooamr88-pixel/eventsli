import Link from 'next/link';
import NavIcon from '../../shell/NavIcon';
import { formatMoney } from '../../../utils/money';

/**
 * One booth on the vendor page (2026-11-21): photo, name, price, size, what
 * is left, the first few inclusions, and the way into its booth page. The
 * whole card is the link; a fully booked booth still opens (its page says so).
 */
export default function BoothCard({ booth, slug, currency }) {
  const href = `/e/${slug}/vendors/booths/${booth.id}`;
  const few = booth.remaining !== null && booth.remaining !== undefined && booth.remaining > 0 && booth.remaining <= 3;
  return (
    <li className={`es-vb-booth ${booth.soldOut ? 'is-off' : ''}`}>
      <Link href={href} className="es-vb-booth__link" aria-label={`${booth.name}, ${booth.priceCents === 0 ? 'free' : formatMoney(booth.priceCents, currency)}${booth.soldOut ? ', fully booked' : ''}`}>
        <span className="es-vb-booth__media">
          {booth.imageUrl
            // eslint-disable-next-line @next/next/no-img-element -- the booth's photo, from storage
            ? <img src={booth.imageUrl} alt="" loading="lazy" />
            : <span className="es-vb-booth__placeholder" aria-hidden="true"><NavIcon name="store" size={40} /></span>}
          {booth.soldOut
            ? <span className="es-vb-booth__badge es-vb-booth__badge--off">Fully booked</span>
            : few && <span className="es-vb-booth__badge">{booth.remaining} left</span>}
        </span>
        <span className="es-vb-booth__body">
          <span className="es-vb-booth__row">
            <span className="es-vb-booth__name fx-break">{booth.name}</span>
            <span className="es-vb-booth__price es-nums">{booth.priceCents === 0 ? 'Free' : formatMoney(booth.priceCents, currency)}</span>
          </span>
          {booth.sizeLabel && <span className="es-vb-booth__size"><NavIcon name="grid" size={14} />{booth.sizeLabel}</span>}
          {booth.includes?.length > 0 && (
            <span className="es-vb-booth__inc">
              {booth.includes.slice(0, 3).map((x) => <span key={x}><NavIcon name="check" size={14} />{x}</span>)}
              {booth.includes.length > 3 && <span className="es-vb-booth__more">+{booth.includes.length - 3} more</span>}
            </span>
          )}
          <span className="es-vb-booth__cta">{booth.soldOut ? 'See details' : 'View booth'}<NavIcon name="arrow" size={16} /></span>
        </span>
      </Link>
    </li>
  );
}
