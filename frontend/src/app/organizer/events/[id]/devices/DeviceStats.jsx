import NavIcon from '../../../../components/shell/NavIcon';

/**
 * The three figures at the top of Scanning devices: is the door open, how
 * many guests are in, how many are still to come.
 *
 * EACH NUMBER SAYS WHAT IT COUNTS. "In" and "To come" are the gate's TICKET
 * counts (`/gate` → stats.admitted / stats.pending), not devices — the API
 * has no notion of a device "scanning now", only when each one was last seen.
 * The first card is the gate's state, with the devices that can scan under it.
 */
export default function DeviceStats({ gate, devices }) {
  const state = gate?.gate;
  const stats = gate?.stats;
  const locked = state?.locked && !state?.override;
  const active = devices.filter((d) => d.isActive).length;

  const cards = [
    {
      key: 'gate',
      icon: 'tablet',
      label: locked ? 'Scanning is off' : state?.override ? 'Scanning allowed for now' : 'Scanning works',
      note: active === 1 ? 'Device that can scan' : 'Devices that can scan',
      value: active,
      featured: !locked,
      tone: locked ? 'danger' : undefined,
    },
    { key: 'in', icon: 'check', label: 'In', note: 'Guests checked in', value: stats?.admitted },
    { key: 'pending', icon: 'clock', label: 'To come', note: 'Tickets not scanned yet', value: stats?.pending },
  ];

  return (
    <div className="es-statline-row" role="group" aria-label="The door at a glance">
      {cards.map((c) => (
        <div key={c.key} className={`es-statline${c.featured ? ' es-statline--featured' : ''}`} data-tone={c.tone}>
          <span className="es-statline__icon" aria-hidden="true"><NavIcon name={c.icon} size={24} /></span>
          <span className="es-statline__text">
            <span className="es-statline__label">{c.label}</span>
            <span className="es-statline__note">{c.note}</span>
          </span>
          <span className="es-statline__value es-nums">
            {typeof c.value === 'number' ? c.value.toLocaleString() : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}
