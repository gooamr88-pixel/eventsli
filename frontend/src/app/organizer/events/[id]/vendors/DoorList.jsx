'use client';

import { useApi } from '../../../../hooks/useApi';
import { Panel } from '../../../../components/ui/Page';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../../../components/Feedback';

/**
 * The vendor door list (2026-11-20): every accepted vendor, their booth and
 * the staff they named, for the people at the vendor entrance. Printable.
 * Staff are named by the vendor in their booking; a pass is a name on this
 * list, not a ticket.
 */
export default function DoorList({ eventId, eventTitle }) {
  const { data, error, reload } = useApi(`/events/${eventId}/vendors/door-list`);
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return <Loading variant="list" label="Loading the door list" />;
  const people = data.reduce((n, v) => n + v.staff.length, 0);

  return (
    <Panel icon="shield" title="Vendor door list"
      description={`${data.length} ${data.length === 1 ? 'vendor' : 'vendors'} · ${people} staff named. Vendors add their staff from their booking.`}
      action={data.length > 0 ? <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => window.print()}><NavIcon name="printer" size={16} />Print</button> : null}>
      {data.length === 0 ? (
        <p className="text-sm text-muted">No vendors have accepted a space yet.</p>
      ) : (
        <div className="es-vd-door">
          <p className="es-vd-door__title">{eventTitle} — vendor entrance</p>
          <table className="es-vd-door__table">
            <thead>
              <tr><th scope="col">Booth</th><th scope="col">Vendor</th><th scope="col">Staff</th><th scope="col">Fee</th></tr>
            </thead>
            <tbody>
              {data.map((v) => (
                <tr key={v.id}>
                  <td className="es-nums">{v.boothLabel || '—'}</td>
                  <td>
                    <b>{v.businessName}</b>
                    <span className="block text-xs text-subtle">{[v.boothName, v.contactName, v.contactPhone].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td>
                    {v.staff.length === 0
                      ? <span className="text-xs text-subtle">None named yet ({v.staffPasses} allowed)</span>
                      : <ul className="es-vd-door__staff">{v.staff.map((s) => <li key={s}>☐ {s}</li>)}</ul>}
                  </td>
                  <td>{v.paid ? <span className="es-pill es-pill--accent">Paid</span> : <span className="es-pill es-pill--warning">Unpaid</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
