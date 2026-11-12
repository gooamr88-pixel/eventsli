'use client';

import { useState } from 'react';
import { post, patch, del } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/Confirm';
import Field from '../../components/forms/Field';
import NavIcon from '../../components/shell/NavIcon';
import { formatCount, EXCLUSION_LABEL } from '../../lib/smsFormat';
import { formatEventTime } from '../../lib/eventTime';

/**
 * An organizer's audiences: groups of THEIR OWN buyers. The server pins every
 * audience to this organizer and refuses an event that is not theirs; the
 * count shows how many people opted in to texts from this organizer.
 */

const EMPTY = { name: '', eventIds: [], purchasedWithinDays: '', minOrders: '', attendedOnly: false };

function toDefinition(f) {
  const def = {};
  if (f.eventIds.length) def.eventIds = f.eventIds;
  if (f.purchasedWithinDays) def.purchasedWithinDays = Number(f.purchasedWithinDays);
  if (f.minOrders) def.minOrders = Number(f.minOrders);
  if (f.attendedOnly) def.attendedOnly = true;
  return def;
}

function Count({ p }) {
  if (!p) return null;
  return (
    <div className="fx-stack fx-stack--sm rounded-(--es-radius-md) bg-bg-sunken p-4 text-sm">
      <p className="text-ink"><strong>{formatCount(p.eligible)}</strong> can receive your texts, of {formatCount(p.audience)} buyers with a phone number.</p>
      {Object.keys(p.excluded || {}).length > 0 && (
        <p className="es-smsmeta">{Object.entries(p.excluded).map(([k, v]) => <span key={k}>{EXCLUSION_LABEL[k] || k}: {formatCount(v)}</span>)}</p>
      )}
    </div>
  );
}

function AudienceForm({ events, segment, onSaved, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState(() => (segment ? {
    name: segment.name, eventIds: segment.definition?.eventIds || [],
    purchasedWithinDays: segment.definition?.purchasedWithinDays ? String(segment.definition.purchasedWithinDays) : '',
    minOrders: segment.definition?.minOrders ? String(segment.definition.minOrders) : '',
    attendedOnly: Boolean(segment.definition?.attendedOnly),
  } : EMPTY));
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(null);
  const toggleEvent = (id) => setF((s) => ({ ...s, eventIds: s.eventIds.includes(id) ? s.eventIds.filter((x) => x !== id) : [...s.eventIds, id] }));

  async function run(fn, done) {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="fx-stack" onSubmit={(e) => {
      e.preventDefault();
      run(async () => {
        const body = { name: f.name.trim(), definition: toDefinition(f) };
        if (segment?.id) await patch(`/organizer/sms/segments/${segment.id}`, body, { noRedirect: true });
        else await post('/organizer/sms/segments', body, { noRedirect: true });
        onSaved();
      }, 'Audience saved.');
    }}>
      <Field label="Name" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} required minLength={2} />
      <fieldset className="fx-stack fx-stack--sm">
        <legend className="mb-1 text-sm font-medium text-ink">Buyers of these events <span className="font-normal text-subtle">(none ticked: all your events)</span></legend>
        <div className="fx-stack fx-stack--sm max-h-56 overflow-auto rounded-(--es-radius-md) border border-(--es-border) p-3">
          {events.length === 0 ? <p className="text-sm text-muted">You have no events yet.</p> : events.map((ev) => (
            <label key={ev.id} className="es-smscheck">
              <input type="checkbox" checked={f.eventIds.includes(ev.id)} onChange={() => toggleEvent(ev.id)} />
              <span>{ev.title}{ev.startsAt && <span className="text-subtle"> · {formatEventTime(ev.startsAt, ev.timezone)}</span>}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="es-smsform">
        <Field label="Bought within (days)" type="number" min={1} max={3650} optional value={f.purchasedWithinDays}
          onChange={(e) => setF((s) => ({ ...s, purchasedWithinDays: e.target.value }))} />
        <Field label="At least this many orders" type="number" min={1} max={100} optional value={f.minOrders}
          onChange={(e) => setF((s) => ({ ...s, minOrders: e.target.value }))} />
      </div>
      <label className="es-smscheck"><input type="checkbox" checked={f.attendedOnly} onChange={(e) => setF((s) => ({ ...s, attendedOnly: e.target.checked }))} /><span>Only people who checked in</span></label>
      <Count p={count} />
      <div className="fx-row gap-2">
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busy}
          onClick={() => run(async () => setCount(await post('/organizer/sms/segments/preview', { definition: toDefinition(f) }, { noRedirect: true })))}>
          <NavIcon name="users" size={16} />Count
        </button>
        <button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy}>Save audience</button>
        <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function OrgAudiences({ segments, events, canEdit, reload }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null);
  const [counts, setCounts] = useState({});

  async function count(s) {
    try {
      const p = await post(`/organizer/sms/segments/${s.id}/preview`, {}, { noRedirect: true });
      setCounts((c) => ({ ...c, [s.id]: p }));
    } catch (err) {
      toast.error(messageFor(err));
    }
  }
  async function remove(s) {
    if (!(await confirm({ title: `Delete “${s.name}”?`, confirmLabel: 'Delete', tone: 'danger', body: <p>Campaigns already sent keep their history.</p> }))) return;
    try {
      await del(`/organizer/sms/segments/${s.id}`, { noRedirect: true });
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  return (
    <div className="fx-stack">
      {editing ? (
        <AudienceForm events={events} segment={editing.id ? editing : null} onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
      ) : canEdit && (
        <div><button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => setEditing({})}><NavIcon name="plus" size={16} />New audience</button></div>
      )}
      {segments.length === 0 ? <p className="text-sm text-muted">No audiences yet.</p> : (
        <ul className="fx-stack fx-stack--sm">
          {segments.map((s) => (
            <li key={s.id} className="fx-stack fx-stack--sm border-b border-(--es-border) pb-3 last:border-0">
              <div className="fx-row fx-row--between items-start gap-2">
                <div className="fx-min0">
                  <p className="font-medium text-ink">{s.name}</p>
                  <p className="text-sm text-muted">{s.summary.split(' · ').filter((part) => part !== '1 organizer').join(' · ') || 'All your buyers'}</p>
                </div>
                <div className="fx-row gap-1">
                  <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => count(s)}>Count</button>
                  {canEdit && <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setEditing(s)}>Edit</button>}
                  {canEdit && <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => remove(s)}>Delete</button>}
                </div>
              </div>
              <Count p={counts[s.id]} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
