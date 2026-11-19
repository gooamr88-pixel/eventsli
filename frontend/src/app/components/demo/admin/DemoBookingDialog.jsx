'use client';

import { useState } from 'react';
import { useApi } from '../../../hooks/useApi';
import { patch, post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useToast } from '../../ui/Toast';
import { Loading, ErrorNotice } from '../../Feedback';
import NavIcon from '../../shell/NavIcon';
import TemplateDialog from '../../templates/TemplateDialog';
import { spanLabel, zoneLabel } from '../../../lib/demoTime';
import { toIso, toLocalInput } from '../../../lib/eventTime';
import { STATUS } from './demoStatus';

/**
 * One demo booking, in the console (2026-11-19): everything the booker sent,
 * and everything the team can do — status, private notes, the call link
 * (optionally emailed), who runs it, move it, cancel it.
 */
export default function DemoBookingDialog({ id, zone, hosts, onClose, onChanged }) {
  const { data, error, loading, reload } = useApi(`/admin/demo/bookings/${id}`);
  return (
    <TemplateDialog id="demo-booking-title" title={data?.booking ? data.booking.name : 'Demo booking'} onClose={onClose} wide>
      {loading ? <Loading rows={4} label="Loading the booking" />
        : error ? <ErrorNotice error={error} onRetry={reload} />
          : <Body key={data.booking.updatedAt} booking={data.booking} manageUrl={data.links?.manageUrl} zone={zone} hosts={hosts}
            onSaved={() => { reload(); onChanged(); }} />}
    </TemplateDialog>
  );
}

function Body({ booking: b, manageUrl, zone, hosts, onSaved }) {
  const toast = useToast();
  const [notes, setNotes] = useState(b.hostNotes || '');
  const [link, setLink] = useState(b.meetingLink || '');
  const [host, setHost] = useState(b.assignedTo || '');
  const [sendLink, setSendLink] = useState(true);
  const [moveTo, setMoveTo] = useState(toLocalInput(b.startsAt, zone));
  const [notifyMove, setNotifyMove] = useState(true);
  const [reason, setReason] = useState('');
  const [notifyCancel, setNotifyCancel] = useState(true);
  const [panel, setPanel] = useState(null);
  const [busy, setBusy] = useState(null);

  const live = b.status === 'confirmed';
  // Read once, when the dialog opens: "has it happened yet" for this view.
  const [future] = useState(() => Date.parse(b.startsAt) > Date.now());
  const dirty = notes !== (b.hostNotes || '') || link !== (b.meetingLink || '') || host !== (b.assignedTo || '');

  async function run(label, fn, done) {
    setBusy(label);
    try {
      await fn();
      toast.success(done);
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(null);
    }
  }

  const save = () => run('save', () => patch(`/admin/demo/bookings/${b.id}`, {
    hostNotes: notes, meetingLink: link.trim(), assignedTo: host || null,
    notify: Boolean(sendLink && link.trim() && link.trim() !== (b.meetingLink || '')),
  }), 'Saved.');
  const setStatus = (status, done) => run(status, () => patch(`/admin/demo/bookings/${b.id}`, { status }), done);
  const move = () => {
    const startsAt = toIso(moveTo, zone);
    if (!startsAt) { toast.error('Choose the new date and time.'); return; }
    run('move', () => post(`/admin/demo/bookings/${b.id}/reschedule`, { startsAt, notify: notifyMove }),
      notifyMove ? 'Moved. They have been emailed the new time.' : 'Moved.');
  };
  const cancel = () => run('cancel', () => post(`/admin/demo/bookings/${b.id}/cancel`, { reason: reason.trim() || undefined, notify: notifyCancel }),
    notifyCancel ? 'Cancelled. They have been emailed.' : 'Cancelled.');

  return (
    <div className="es-demo-admin__dialog">
      <div className="es-demo-admin__top">
        <span className={`es-pill ${STATUS[b.status][1]}`}>{STATUS[b.status][0]}</span>
        <p className="es-demo-admin__big">{spanLabel(b.startsAt, b.endsAt, zone)}</p>
        <p className="es-demo-admin__small">Our time · {zoneLabel(zone)}</p>
        {b.bookerTimezone && b.bookerTimezone !== zone && (
          <p className="es-demo-admin__small">Theirs: {spanLabel(b.startsAt, b.endsAt, b.bookerTimezone)} · {zoneLabel(b.bookerTimezone)}</p>
        )}
        {b.rescheduleCount > 0 && <p className="es-demo-admin__small">Moved {b.rescheduleCount} time{b.rescheduleCount === 1 ? '' : 's'}.</p>}
        {b.status === 'cancelled' && (
          <p className="es-demo-admin__small">
            Cancelled by {b.cancelledBy === 'admin' ? 'the team' : 'them'}{b.cancelReason ? ` — “${b.cancelReason}”` : ''}.
          </p>
        )}
      </div>

      <dl className="es-demo-admin__facts">
        <div><dt>Email</dt><dd><a href={`mailto:${b.email}`}>{b.email}</a></dd></div>
        {b.phone && <div><dt>Phone</dt><dd><a href={`tel:${b.phone.replace(/[^0-9+]/g, '')}`}>{b.phone}</a></dd></div>}
        {b.company && <div><dt>Event or website</dt><dd className="fx-break">{b.company}</dd></div>}
        {b.topic && <div><dt>Topic</dt><dd>{b.topic}</dd></div>}
        {b.answers.map((a) => <div key={a.id}><dt>{a.label}</dt><dd className="fx-break">{a.answer}</dd></div>)}
        {b.message && <div><dt>Message</dt><dd className="fx-break whitespace-pre-line">{b.message}</dd></div>}
        <div><dt>Booked</dt><dd>{new Date(b.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone })}</dd></div>
      </dl>

      {live && (
        <div className="es-demo-admin__actions">
          {!future && (
            <>
              <button type="button" className="es-btn es-btn--primary es-btn--sm" disabled={Boolean(busy)} onClick={() => setStatus('completed', 'Marked as done.')}>
                <NavIcon name="check" size={16} /> Mark as done
              </button>
              <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={Boolean(busy)} onClick={() => setStatus('no_show', 'Marked as missed.')}>
                They did not come
              </button>
            </>
          )}
          <button type="button" className="es-btn es-btn--secondary es-btn--sm" aria-expanded={panel === 'move'} onClick={() => setPanel(panel === 'move' ? null : 'move')}>
            <NavIcon name="calendar" size={16} /> Move
          </button>
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" aria-expanded={panel === 'cancel'} onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>
            Cancel the demo
          </button>
        </div>
      )}
      {(b.status === 'completed' || b.status === 'no_show') && (
        <div className="es-demo-admin__actions">
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={Boolean(busy)} onClick={() => setStatus('confirmed', 'Back to booked.')}>
            <NavIcon name="undo" size={16} /> Back to booked
          </button>
        </div>
      )}

      {panel === 'move' && live && (
        <div className="es-demo-admin__panel">
          <label className="es-demo-admin__label" htmlFor="demo-move-at">New date and time <span>({zoneLabel(zone)})</span></label>
          <input id="demo-move-at" type="datetime-local" className="es-input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} />
          <p className="es-demo-admin__small">Any time works here, outside the public hours too. Another demo at that time is refused unless the settings allow more than one at once.</p>
          <label className="es-demo-admin__check"><input type="checkbox" checked={notifyMove} onChange={(e) => setNotifyMove(e.target.checked)} /> Email them the new time</label>
          <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={move} disabled={busy === 'move'}>{busy === 'move' ? 'Moving…' : 'Move the demo'}</button>
        </div>
      )}

      {panel === 'cancel' && live && (
        <div className="es-demo-admin__panel">
          <label className="es-demo-admin__label" htmlFor="demo-cancel-why">Reason <span>(optional — included in their email)</span></label>
          <textarea id="demo-cancel-why" className="es-input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <label className="es-demo-admin__check"><input type="checkbox" checked={notifyCancel} onChange={(e) => setNotifyCancel(e.target.checked)} /> Email them that it is cancelled</label>
          <button type="button" className="es-btn es-btn--danger es-btn--sm" onClick={cancel} disabled={busy === 'cancel'}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel the demo'}</button>
        </div>
      )}

      <div className="es-demo-admin__panel">
        <label className="es-demo-admin__label" htmlFor="demo-link">Video call link</label>
        <input id="demo-link" type="url" className="es-input" placeholder="https://meet.google.com/…" value={link} onChange={(e) => setLink(e.target.value)} maxLength={1000} />
        {live && future && link.trim() && link.trim() !== (b.meetingLink || '') && (
          <label className="es-demo-admin__check"><input type="checkbox" checked={sendLink} onChange={(e) => setSendLink(e.target.checked)} /> Email them the link when I save</label>
        )}
        <label className="es-demo-admin__label" htmlFor="demo-host">Who runs it</label>
        <select id="demo-host" className="es-input" value={host} onChange={(e) => setHost(e.target.value)}>
          <option value="">Nobody yet</option>
          {hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <label className="es-demo-admin__label" htmlFor="demo-notes">Team notes <span>(never shown to them)</span></label>
        <textarea id="demo-notes" className="es-input" rows={4} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="es-demo-admin__actions">
          <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={save} disabled={!dirty || busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
          {manageUrl && live && (
            <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => navigator.clipboard?.writeText(manageUrl).then(() => toast.success('Their change-or-cancel link is copied.'))}>
              <NavIcon name="link" size={16} /> Copy their booking link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
