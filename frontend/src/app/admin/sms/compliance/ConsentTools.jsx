'use client';

import { useState } from 'react';
import { get, post } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useToast } from '../../../components/ui/Toast';
import Field, { TextareaField } from '../../../components/forms/Field';
import { formatCount } from '../../../lib/smsFormat';

/**
 * Consent: look one number up (its current answer, its history, its evidence),
 * or import consent collected elsewhere with a statement of where it came from.
 *
 * An import never re-subscribes someone who opted out, and in double-opt-in
 * countries it records 'pending' — those people are not marketed to until
 * they reply YES themselves.
 */

const STATUS = { opted_in: 'Opted in', opted_out: 'Opted out', pending: 'Pending confirmation' };

export default function ConsentTools({ canSuper }) {
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState(null);
  const [imp, setImp] = useState({ phones: '', evidence: '', defaultCountry: '' });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function lookup(e) {
    e.preventDefault();
    setBusy(true);
    try {
      setFound(await get(`/admin/sms/consents?phone=${encodeURIComponent(phone)}`, { noRedirect: true }));
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  async function importList(e) {
    e.preventDefault();
    const phones = imp.phones.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
    if (phones.length === 0) { toast.error('Paste at least one number.'); return; }
    setBusy(true);
    try {
      const r = await post('/admin/sms/consents/import', {
        phones, evidence: imp.evidence.trim(), ...(imp.defaultCountry ? { defaultCountry: imp.defaultCountry.trim().toUpperCase() } : {}),
      }, { noRedirect: true });
      setResult(r);
      toast.success(`${formatCount(r.recorded)} consents recorded.`);
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fx-stack">
      <form onSubmit={lookup} className="fx-row items-end gap-2">
        <div className="flex-1"><Field label="Look up a number" value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="+1 416 555 0199" /></div>
        <button type="submit" className="es-btn es-btn--secondary es-btn--sm" disabled={busy}>Look up</button>
      </form>
      {found && (
        <div className="fx-stack fx-stack--sm rounded-(--es-radius-md) bg-bg-sunken p-4 text-sm">
          <p className="font-medium text-ink">{found.phone} · {found.country}</p>
          {found.suppression && <p className="text-danger">Suppressed ({found.suppression.scope}): {found.suppression.reason.replace(/_/g, ' ')}</p>}
          {found.consents.length === 0 ? <p className="text-muted">No consent on record. Marketing is not sent to this number.</p>
            : found.consents.map((c) => <p key={c.scope}>{c.scope === 'platform' ? 'Eventsli' : `Organizer ${c.scope.slice(0, 8)}`}: <strong>{STATUS[c.status]}</strong> via {c.source} · {new Date(c.updatedAt).toLocaleString()}</p>)}
          {found.history.length > 0 && (
            <details>
              <summary className="cursor-pointer text-accent">History ({found.history.length})</summary>
              <ol className="es-smsmeta mt-2" style={{ flexDirection: 'column' }}>
                {found.history.map((h, i) => (
                  <li key={i}>{new Date(h.at).toLocaleString()} · {STATUS[h.status]} · {h.source}{h.evidence?.statement ? ` · “${h.evidence.statement}”` : ''}</li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}

      {canSuper && (
        <form onSubmit={importList} className="fx-stack fx-stack--sm border-t border-(--es-border) pt-4">
          <p className="font-medium text-ink">Import consent</p>
          <TextareaField label="Numbers" rows={4} value={imp.phones} onChange={(e) => setImp((s) => ({ ...s, phones: e.target.value }))} required
            hint="One per line, international format. Up to 5,000." />
          <Field label="Default country for local numbers" value={imp.defaultCountry} onChange={(e) => setImp((s) => ({ ...s, defaultCountry: e.target.value }))} optional maxLength={2} />
          <TextareaField label="Where this consent came from" rows={2} value={imp.evidence} onChange={(e) => setImp((s) => ({ ...s, evidence: e.target.value }))} required minLength={20}
            hint="Stored on every record, e.g. “Opt-in checkbox on the Spring Gala sign-up form, March 2026, wording: …”" />
          <div><button type="submit" className="es-btn es-btn--secondary es-btn--sm" disabled={busy}>Import</button></div>
          {result && (
            <p className="es-smsmeta">
              <span>{formatCount(result.recorded)} recorded</span><span>{formatCount(result.pending)} pending double opt-in</span>
              <span>{formatCount(result.keptOptOut)} kept opted out</span><span>{formatCount(result.alreadyOptedIn)} already in</span><span>{formatCount(result.invalid)} invalid</span>
            </p>
          )}
        </form>
      )}
    </div>
  );
}
