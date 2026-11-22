'use client';

import { useState } from 'react';
import { get, post, put, patch, del } from '../../../../utils/apiClient';
import { describeError } from '../../../../utils/errors';
import { formatMoney } from '../../../../utils/money';
import { formatEventTime } from '../../../../lib/eventTime';
import { useApi } from '../../../../hooks/useApi';
import { useToast } from '../../../../components/ui/Toast';
import { SectionHeader, Panel } from '../../../../components/ui/Page';
import { Kpi, KpiRow } from '../../../../components/ui/Kpi';
import { Segmented } from '../../../../components/ui/Filters';
import DataTable from '../../../../components/ui/DataTable';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import NavIcon from '../../../../components/shell/NavIcon';
import { useEventContext } from '../EventContext';
import { guestsCsv } from './guestsCsv';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HOSTS & GUESTS (2026-11-23, the owner: "know where each ticket buyer comes
 * from and from whom — the guest says 'I come from the groom', and the groom
 * receives an email, or the bride and the bride receives an email").
 *
 *   THE QUESTION  off, optional or required at checkout, in the organizer's
 *                 own words ("Whose guest are you?", "Bride's or groom's side?").
 *   THE HOSTS     the people a guest can come from. Each has an optional
 *                 email (told about every booking under them), their own
 *                 share link that picks them at checkout, and a private
 *                 guest-list link that can be reset.
 *   THE NUMBERS   bookings, tickets and money per host, and the bookings with
 *                 no host named; each host's guests, with a CSV.
 *
 * The work is in backend services/guestOfService.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MODES = [
  { value: 'off', label: 'Don’t ask' },
  { value: 'optional', label: 'Ask, optional' },
  { value: 'required', label: 'Ask, required' },
];

export default function HostGuests({ eventId }) {
  const event = useEventContext()?.event;
  const api = useApi(`/events/${eventId}/hosts`);
  if (api.error) return <ErrorNotice error={api.error} onRetry={api.reload} />;
  if (!api.data) return <Loading variant="card" label="Loading hosts" />;
  return <Loaded eventId={eventId} data={api.data} reload={api.reload} timezone={event?.timezone} />;
}

function Loaded({ eventId, data, reload, timezone }) {
  const { settings, hosts, unassigned, currency } = data;
  const active = hosts.filter((h) => h.active);
  const withHost = hosts.reduce((s, h) => ({ orders: s.orders + h.stats.orders, tickets: s.tickets + h.stats.tickets }), { orders: 0, tickets: 0 });

  return (
    <div className="fx-stack">
      <SectionHeader
        icon="users"
        title="Hosts & guests"
        lede="Ask buyers whose guest they are — the groom’s or the bride’s, a family, a department, a promoter. Each host is emailed when a guest books under them, and has a private list of their guests."
      />

      <KpiRow label="Guests by host">
        <Kpi icon="users" label="Hosts" value={String(active.length)} note={hosts.length > active.length ? `${hosts.length - active.length} off the list` : null} />
        <Kpi icon="receipt" label="Bookings with a host" value={String(withHost.orders)} note={`${withHost.tickets} tickets`} featured />
        <Kpi icon="info" label="No host named" value={String(unassigned.orders)} note={`${unassigned.tickets} tickets`} />
      </KpiRow>

      <QuestionPanel eventId={eventId} settings={settings} hostCount={active.length} onSaved={reload} />

      <Panel title="Hosts" description="Who your guests can come from. Add an email to tell them about each booking.">
        <div className="fx-stack">
          {hosts.length === 0 && <p className="text-sm text-muted">No hosts yet. Add the first one below — for a wedding, the groom and the bride.</p>}
          {hosts.map((h) => (
            <HostRow key={h.id} eventId={eventId} host={h} currency={currency} timezone={timezone} onChanged={reload} />
          ))}
          <AddHost eventId={eventId} onAdded={reload} />
        </div>
      </Panel>
    </div>
  );
}

function QuestionPanel({ eventId, settings, hostCount, onSaved }) {
  const toast = useToast();
  const [mode, setMode] = useState(settings.mode);
  const [question, setQuestion] = useState(settings.question);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dirty = mode !== settings.mode || question.trim() !== settings.question;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await put(`/events/${eventId}/hosts/settings`, { mode, question: question.trim() || settings.defaultQuestion }, { noRedirect: true });
      toast.success(mode === 'off' ? 'Saved. Checkout won’t ask.' : 'Saved. Checkout will ask buyers whose guest they are.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="At checkout" description="The question buyers answer, and whether they must.">
      <div className="fx-stack fx-stack--sm">
        <Segmented label="Ask buyers" showLabel value={mode} onChange={setMode} options={MODES} />
        {mode !== 'off' && (
          <Field
            label="The question" maxLength={120} value={question} onChange={(e) => setQuestion(e.target.value)}
            placeholder={settings.defaultQuestion}
            hint="For example: “Whose guest are you?” or “Bride’s side or groom’s side?”"
          />
        )}
        {mode !== 'off' && hostCount === 0 && (
          <p className="text-sm text-warning">Add at least one host below — the question shows only when there is someone to choose.</p>
        )}
        <FormError error={error} />
        <div className="fx-row">
          <button type="button" className="es-btn es-btn--primary es-btn--sm" disabled={!dirty || busy} onClick={save}>
            <NavIcon name="tick" size={16} /> {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Panel>
  );
}

async function copy(text, toast, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error('Could not copy. Select the link and copy it by hand.');
  }
}

function HostRow({ eventId, host, currency, timezone, onChanged }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: host.name, email: host.email || '' });
  const [open, setOpen] = useState(false);
  const [guests, setGuests] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function act(kind, fn) {
    setBusy(kind);
    setError(null);
    try { await fn(); } catch (err) { setError(err); } finally { setBusy(null); }
  }

  const saveEdit = () => act('save', async () => {
    await patch(`/events/${eventId}/hosts/${host.id}`, { name: form.name.trim(), email: form.email.trim() || null }, { noRedirect: true });
    setEditing(false);
    onChanged();
  });
  const toggle = (key, value) => act(key, async () => {
    await patch(`/events/${eventId}/hosts/${host.id}`, { [key]: value }, { noRedirect: true });
    onChanged();
  });
  const remove = () => act('remove', async () => {
    const r = await del(`/events/${eventId}/hosts/${host.id}`, { noRedirect: true });
    toast.success(r.removed ? 'Host removed.' : 'Taken off the list. Their guests are kept.');
    onChanged();
  });
  const resetLink = () => act('reset', async () => {
    const r = await post(`/events/${eventId}/hosts/${host.id}/reset-link`, {}, { noRedirect: true });
    await copy(r.listUrl, toast, 'New guest-list link');
    onChanged();
  });
  const showGuests = () => act('guests', async () => {
    if (open) { setOpen(false); return; }
    setGuests((await get(`/events/${eventId}/hosts/${host.id}/guests`, { cache: 'no-store' })).guests);
    setOpen(true);
  });
  function download() {
    const blob = new Blob([guestsCsv(host, guests || [], currency)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `guests-${host.code}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <article className="es-hostrow" data-off={host.active ? undefined : 'true'} aria-label={host.name}>
      <div className="es-hostrow__head">
        {editing ? (
          <div className="es-hostrow__edit">
            <Field label="Name" maxLength={80} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <Field label="Email" optional type="email" maxLength={254} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            <div className="fx-row">
              <button type="button" className="es-btn es-btn--primary es-btn--sm" disabled={!form.name.trim() || busy === 'save'} onClick={saveEdit}>Save</button>
              <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => { setEditing(false); setForm({ name: host.name, email: host.email || '' }); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="fx-min0">
            <h3 className="es-hostrow__name">{host.name}{!host.active && <span className="es-pill">Off the list</span>}</h3>
            <p className="es-hostrow__meta">
              {host.email ? <>{host.email}{host.notify ? ' · emailed on each booking' : ' · emails off'}</> : 'No email — not notified'}
            </p>
          </div>
        )}
        <dl className="es-hostrow__stats">
          <div><dt>Bookings</dt><dd className="es-nums">{host.stats.orders}</dd></div>
          <div><dt>Tickets</dt><dd className="es-nums">{host.stats.tickets}</dd></div>
          <div><dt>Sales</dt><dd className="es-nums">{formatMoney(host.stats.revenueCents, currency)}</dd></div>
        </dl>
      </div>

      <div className="es-hostrow__actions">
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => copy(host.link, toast, 'Invite link')}>
          <NavIcon name="link" size={16} /> Copy invite link
        </button>
        <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => copy(host.listUrl, toast, 'Guest-list link')}>
          <NavIcon name="copy" size={16} /> Copy guest-list link
        </button>
        <button type="button" className="es-btn es-btn--ghost es-btn--sm" aria-expanded={open} onClick={showGuests} disabled={busy === 'guests'}>
          <NavIcon name="users" size={16} /> {open ? 'Hide guests' : 'See guests'}
        </button>
        {!editing && <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setEditing(true)}><NavIcon name="pencil" size={16} /> Edit</button>}
        {host.email && (
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => toggle('notify', !host.notify)} disabled={busy === 'notify'}>
            <NavIcon name="mail" size={16} /> {host.notify ? 'Stop emails' : 'Send emails'}
          </button>
        )}
        <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={resetLink} disabled={busy === 'reset'}
          title="Makes a new private guest-list link; the old one stops working.">
          <NavIcon name="refresh" size={16} /> New guest-list link
        </button>
        {host.active ? (
          <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={remove} disabled={busy === 'remove'}>
            <NavIcon name="trash" size={16} /> Remove
          </button>
        ) : (
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => toggle('active', true)}>Put back on the list</button>
        )}
      </div>

      {error && <p className="text-sm text-danger" role="alert">{describeError(error).title}. {describeError(error).recovery}</p>}

      {open && guests && (
        <div className="fx-stack fx-stack--sm">
          {guests.length === 0 ? (
            <p className="text-sm text-muted">No guests have booked under {host.name} yet. Share their invite link.</p>
          ) : (
            <>
              <DataTable
                caption={`Guests of ${host.name}`}
                rows={guests}
                rowKey={(g) => g.orderId}
                columns={[
                  {
                    key: 'name', label: 'Guest', primary: true,
                    render: (g) => (
                      <span className="fx-stack fx-stack--sm gap-0.5">
                        <span className="fx-break text-ink">{g.name}</span>
                        <span className="fx-break text-sm text-muted">{[g.email, g.phone].filter(Boolean).join(' · ') || 'No contact given'}</span>
                      </span>
                    ),
                  },
                  { key: 'tickets', label: 'Tickets', align: 'end', render: (g) => <span className="es-nums">{g.tickets}</span> },
                  { key: 'paid', label: 'Paid', align: 'end', render: (g) => <span className="es-nums">{formatMoney(g.totalCents, currency)}</span> },
                  { key: 'status', label: 'Status', render: (g) => <span className="es-pill">{g.status === 'paid' ? 'Confirmed' : 'Awaiting payment'}</span> },
                  { key: 'when', label: 'Booked', wide: true, render: (g) => <span className="whitespace-nowrap">{formatEventTime(g.bookedAt, timezone)}</span> },
                ]}
              />
              <div className="fx-row">
                <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={download}>
                  <NavIcon name="download" size={16} /> Download CSV
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function AddHost({ eventId, onAdded }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function add(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/events/${eventId}/hosts`, { name: form.name.trim(), email: form.email.trim() || null, notify: true }, { noRedirect: true });
      toast.success(`${form.name.trim()} added.`);
      setForm({ name: '', email: '' });
      onAdded();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="es-hostadd" onSubmit={add}>
      <h3 className="es-hostadd__title">Add a host</h3>
      <div className="es-hostadd__fields">
        <Field label="Name" maxLength={80} placeholder="e.g. The groom — Ahmed" value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Field label="Email" optional type="email" maxLength={254} placeholder="Told about each guest who books"
          value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
      </div>
      <FormError error={error} />
      <div className="fx-row">
        <button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy || !form.name.trim()}>
          <NavIcon name="plus" size={16} /> {busy ? 'Adding…' : 'Add host'}
        </button>
      </div>
    </form>
  );
}
