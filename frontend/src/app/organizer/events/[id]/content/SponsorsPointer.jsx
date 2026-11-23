'use client';

import Link from 'next/link';
import NavIcon from '../../../../components/shell/NavIcon';
import { usePartnerSwitch } from '../PartnersCard';
import ContentCard from './ContentCard';

/**
 * Where the sponsors editor used to be on the Event page screen.
 *
 * Sponsors had TWO homes: logos typed in here, and the Sponsors desk, where a
 * paid deal goes on the page by itself. Nothing said which to use, and the two
 * lists showed side by side on the public page. The hand-added logos moved to
 * the Sponsors screen (owner, 2026-11-23); this card says so and goes there —
 * or, for an event that has not turned sponsors on, offers to.
 */
export default function SponsorsPointer({ event, count }) {
  const { turnOn, busy } = usePartnerSwitch(event.id);
  const on = Boolean(event.partners?.sponsors);
  return (
    <ContentCard
      icon="handshake"
      title="Sponsors"
      description={on
        ? `Sponsors on your page are managed on the Sponsors screen${count ? ` — ${count} shown now` : ''}.`
        : 'Show sponsor logos on your page, or sell sponsorship packages to brands.'}
    >
      {on ? (
        <Link href={`/organizer/events/${event.id}/sponsors`} className="es-btn es-btn--secondary es-btn--sm self-start">
          Go to Sponsors<NavIcon name="arrow" size={16} />
        </Link>
      ) : (
        <button type="button" className="es-btn es-btn--secondary es-btn--sm self-start" disabled={busy === 'sponsors'} onClick={() => turnOn('sponsors')}>
          <NavIcon name="plus" size={16} />{busy === 'sponsors' ? 'Turning on…' : 'Add sponsors'}
        </button>
      )}
    </ContentCard>
  );
}
