import NavIcon from '../../../../components/shell/NavIcon';

/**
 * Discount codes, before the first one exists.
 *
 * The page used to open on a dashed box reading "No codes yet." — true, and no
 * help to an organizer who has never run a promotion. This says what a code is
 * FOR, with the three uses organizers actually reach for, and puts the button
 * where the eye already is.
 *
 * The ideas are labelled "Examples only" and are not buttons: picking one does
 * not pre-fill a code, so they must not look as if it would.
 */

const IDEAS = [
  { key: 'early', icon: 'calendar', title: 'Early bird', text: 'A time-limited discount with a limited quantity (e.g., 20% off for the first 100 tickets).' },
  { key: 'partner', icon: 'users', title: 'Partner offer', text: 'A special discount for a specific audience (e.g., 15% off for a sponsor or partner group).' },
  { key: 'mailing', icon: 'mail', title: 'Mailing list', text: 'A private code for your subscribers (e.g., 10% off for your email list).' },
];

export default function PromoEmpty({ onAdd }) {
  return (
    <div className="fx-stack">
      <div className="es-promo-empty">
        <section className="es-dcard es-promo-start" aria-labelledby="promo-start">
          <TicketArt />
          <h2 id="promo-start" className="es-promo-start__title">Create your first discount code</h2>
          <p className="es-promo-start__text">
            Offer a discount for early-bird buyers, partners, or your mailing list to drive more ticket sales.
          </p>
          <button type="button" className="es-btn es-btn--primary" onClick={onAdd}>
            <NavIcon name="plus" size={18} />
            Add discount code
          </button>
        </section>

        <section className="es-dcard" aria-labelledby="promo-ideas">
          <div className="es-dcard__head">
            <h2 id="promo-ideas" className="es-dcard__title">Plan your promotion</h2>
            <span className="es-pill">Examples only</span>
          </div>
          <p className="es-ovcard__desc -mt-2">Common ways to use discount codes for your event:</p>
          <ul className="es-promo-ideas">
            {IDEAS.map((idea) => (
              <li key={idea.key}>
                <span className="es-tips__icon" aria-hidden="true"><NavIcon name={idea.icon} size={20} /></span>
                <span className="fx-min0">
                  <b>{idea.title}</b>
                  <small>{idea.text}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="es-promo-tip">
        <NavIcon name="info" size={20} />
        <span><b>Tip:</b> Limited-use codes are reserved during seat holds to prevent duplicate use.</span>
      </p>
    </div>
  );
}

/** Two tickets, the front one stamped with a percent sign. Decorative; drawn
 *  from the theme's roles so it follows dark mode with everything else. */
function TicketArt() {
  const ticket = 'M10 0H160A10 10 0 0 1 170 10V38A12 12 0 0 0 170 62V90A10 10 0 0 1 160 100H10A10 10 0 0 1 0 90V62A12 12 0 0 0 0 38V10A10 10 0 0 1 10 0Z';
  return (
    <svg className="es-promo-art" viewBox="0 0 320 190" aria-hidden="true" focusable="false">
      <ellipse className="es-promo-art__ground" cx="165" cy="164" rx="122" ry="20" />
      <g transform="translate(98 56) rotate(-6)">
        <path className="es-promo-art__back" d={ticket} />
      </g>
      <g transform="translate(70 52) rotate(-12)">
        <path className="es-promo-art__front" d={ticket} />
        <path className="es-promo-art__perf" d="M36 12V88M134 12V88" />
        <path className="es-promo-art__mark" d="M101 30 69 72" />
        <circle className="es-promo-art__mark" cx="73" cy="36" r="7" />
        <circle className="es-promo-art__mark" cx="97" cy="66" r="7" />
      </g>
      <path className="es-promo-art__spark" d="M150 6V18M128 14l7 8M172 14l-7 8" />
    </svg>
  );
}
