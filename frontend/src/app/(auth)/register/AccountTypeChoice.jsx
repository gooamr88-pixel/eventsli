import Link from 'next/link';
import NavIcon from '../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS THIS ACCOUNT FOR — asked once, at the top of sign-up.
 *
 * WHAT THIS REPLACES. The choice existed, but only as two unrelated URLs:
 * `/register` and `/register/organizer`, reachable from different marketing
 * links and each unaware of the other. Somebody who landed on the wrong one had
 * to notice, leave, and find the other — and somebody who landed on the right
 * one was never told there had been a decision. The answer is stored in the
 * database either way, so the one thing missing was showing the person what
 * they were choosing.
 *
 * IT STAYS ON SCREEN after the choice, with the current side marked, because
 * the two forms ask for DIFFERENT things — an organizer sign-up wants the
 * organization's name, a phone number and two agreements — and somebody
 * halfway down the longer form needs to be able to see why, and to change
 * their mind without hunting for a link.
 *
 * `?next=` IS CARRIED ACROSS. Both sides are reachable mid-flow — a checkout
 * bounce, an invitation — and switching sides must not quietly drop where the
 * person was going.
 *
 * WHAT IT DOES NOT DO. Choosing "Organizer" here does not make anybody one. It
 * records an account TYPE, which decides which screen they open on; the
 * organizer ROLE is granted server-side when an organization is actually
 * created. `utils/accountTypes.js` on the API side argues the separation.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AccountTypeChoice({ current, next }) {
  const query = next ? `?next=${encodeURIComponent(next)}` : '';

  return (
    <fieldset className="fx-stack fx-stack--sm border-0 p-0">
      <legend className="es-eyebrow mb-2">What brings you here?</legend>

      <div className="es-choice-grid es-choice-grid--2">
        <Option
          href={`/register${query}`}
          selected={current === 'buyer'}
          icon="ticket"
          title="I'm buying tickets"
          desc="Find events and keep every ticket in one place."
          points={['Your tickets on any device', 'Order history and receipts', 'Takes a minute']}
        />
        <Option
          href={`/register/organizer${query}`}
          selected={current === 'organizer'}
          icon="briefcase"
          title="I'm running events"
          desc="Sell tickets to your own events on Eventsli."
          points={['Ticket types, seating and discounts', 'Payouts through Stripe or by hand', 'You can still buy tickets']}
        />
      </div>

      <p className="text-xs text-subtle">
        Not sure? Start as a buyer — you can set up selling later without making a second account.
      </p>
    </fieldset>
  );
}

function Option({ href, selected, icon, title, desc, points }) {
  return (
    <Link
      href={href}
      // `aria-current` is both the style hook the card already has and the
      // honest announcement: this is the page you are on, not a checked input.
      aria-current={selected ? 'true' : undefined}
      className="es-choice"
    >
      <span className="es-choice__icon"><NavIcon name={icon} size={20} /></span>
      <span className="es-choice__body">
        <span className="es-choice__title">{title}</span>
        <span className="es-choice__desc">{desc}</span>
        <ul className="es-choice__list">
          {points.map((point) => (
            <li key={point}>
              <NavIcon name="tick" size={14} />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </span>
    </Link>
  );
}
