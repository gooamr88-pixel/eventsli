'use client';

import Link from 'next/link';
import { formatMoney } from '../../utils/money';
import { formatEventTime } from '../../lib/eventTime';
import { useApi } from '../../hooks/useApi';
import { SectionHeader } from '../../components/ui/Page';
import NavIcon from '../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../components/Feedback';
import { StatusPill, LevelBadge } from '../../components/sponsors/sponsorUi';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SPONSOR'S SIDE (2026-11-20): every sponsorship sent to this account's
 * email address, or to a company this account belongs to. Each opens on its
 * own page to read the proposal, sign it, set the logo and pay.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function MySponsorships() {
  const { data, error, reload } = useApi('/partner/sponsorships');

  return (
    <div className="fx-stack">
      <SectionHeader
        icon="handshake"
        title="Sponsorships"
        lede="Proposals event organizers have sent you. Read them, sign, add your logo and pay — all from here."
      />
      {error ? <ErrorNotice error={error} onRetry={reload} /> : !data ? <Loading variant="card" label="Loading your sponsorships" /> : data.length === 0 ? (
        <div className="es-sp-empty">
          <NavIcon name="handshake" size={36} />
          <p className="es-sp-empty__title">No sponsorships yet</p>
          <p className="text-sm text-muted">When an organizer sends a sponsorship proposal to your email address, it appears here.</p>
        </div>
      ) : (
        <ul className="es-sp-mine">
          {data.map((d) => {
            const action = d.status === 'proposal' && !d.expired ? 'Review and sign'
              : (d.status === 'signed' || d.status === 'part_paid') ? 'Pay' : 'Open';
            return (
              <li key={d.id}>
                <Link href={`/account/sponsorships/${d.id}`} className="es-sp-mine__item">
                  {d.event?.coverUrl
                    // eslint-disable-next-line @next/next/no-img-element -- the event's poster, from storage
                    ? <img src={d.event.coverUrl} alt="" className="es-sp-mine__cover" />
                    : <span className="es-sp-mine__cover es-sp-mine__cover--blank" aria-hidden="true"><NavIcon name="calendar" size={24} /></span>}
                  <span className="fx-min0 fx-stack fx-stack--sm gap-1">
                    <span className="es-sp-mine__title fx-break">{d.event?.title || 'Event'}</span>
                    <span className="text-sm text-muted">
                      {d.companyName}
                      {d.event?.organizerName ? ` · with ${d.event.organizerName}` : ''}
                      {d.event?.startsAt ? ` · ${formatEventTime(d.event.startsAt, d.event.timezone, { time: false })}` : ''}
                    </span>
                    <span className="fx-row gap-2 items-center">
                      <StatusPill status={d.status} sponsor expired={d.expired} />
                      <LevelBadge level={d.level} />
                      {d.amountCents > 0 && <b className="es-nums text-sm">{formatMoney(d.amountCents, d.currency)}</b>}
                      {d.nextDue && <span className="text-xs text-subtle">Next {formatMoney(d.nextDue.amountCents, d.currency)} due {formatEventTime(d.nextDue.dueAt, d.event?.timezone, { time: false })}</span>}
                    </span>
                  </span>
                  <span className="es-sp-mine__go">{action}<NavIcon name="arrow" size={16} /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
