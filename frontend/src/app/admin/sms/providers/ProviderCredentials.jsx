'use client';

import { useState } from 'react';
import { put, post, del, get } from '../../../utils/apiClient';
import { describeError, messageFor } from '../../../utils/errors';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/Confirm';
import Field from '../../../components/forms/Field';
import { Notice } from '../../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A provider's credentials, from the console.
 *
 * WRITE-ONLY. The server never sends a secret back: each field shows whether
 * it is set and where from (an environment variable, or stored encrypted
 * here), and at most the last four characters of a non-secret ID. A blank
 * field keeps what is stored, so a token need not be re-typed to change
 * anything else.
 *
 * "Test" checks the account read-only (Twilio: account status; Vonage:
 * balance) — with what is typed, before saving, or with what is saved. It
 * never sends a message. "Numbers" lists the account's numbers to import as
 * senders, which arrive switched off.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SOURCE = { env: 'Set on the server (environment)', stored: 'Stored here, encrypted' };

export default function ProviderCredentials({ provider, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const status = provider.credentials;
  const fields = Object.entries(status.fields || {});
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(null);
  const [test, setTest] = useState(null);
  const [numbers, setNumbers] = useState(null);
  const [picked, setPicked] = useState({});
  const typed = Object.values(values).some((v) => String(v || '').trim());

  async function run(what, fn) {
    setBusy(what);
    try {
      await fn();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(null);
    }
  }

  const save = () => run('save', async () => {
    await put(`/admin/sms/providers/${provider.id}/credentials`, values, { noRedirect: true });
    setValues({});
    toast.success(`${provider.displayName} credentials saved, encrypted.`);
    onChanged();
  });
  const runTest = () => run('test', async () => {
    const r = await post(`/admin/sms/providers/${provider.id}/test`, typed ? values : {}, { noRedirect: true });
    setTest(r);
    if (!typed) onChanged();
  });
  const remove = () => run('delete', async () => {
    if (!(await confirm({ title: `Remove stored ${provider.displayName} credentials?`, body: <p>Environment variables, if any, keep working. Without either, the provider is switched off.</p>, confirmLabel: 'Remove', tone: 'danger' }))) return;
    await del(`/admin/sms/providers/${provider.id}/credentials`, { noRedirect: true });
    toast.success('Stored credentials removed.');
    onChanged();
  });
  const loadNumbers = () => run('numbers', async () => {
    setNumbers(await get(`/admin/sms/providers/${provider.id}/numbers`, { noRedirect: true }));
    setPicked({});
  });
  const importPicked = () => run('import', async () => {
    const chosen = numbers.filter((n) => picked[n.value]);
    const r = await post(`/admin/sms/providers/${provider.id}/numbers/import`, {
      numbers: chosen.map((n) => ({ value: n.value, kind: n.kind, label: n.label, country: n.country || null })),
    }, { noRedirect: true });
    toast.success(`${r.imported} imported as senders, switched off. Check each one’s registration under Sender IDs, then turn it on.`);
    setNumbers(null);
    onChanged();
  });

  return (
    <div className="fx-stack fx-stack--sm border-t border-(--es-border) pt-4">
      <p className="font-medium text-ink">Credentials</p>
      {!status.keyConfigured && (
        <Notice tone="info" title="Storing credentials here is off.">
          <p>Set SMS_CREDENTIALS_KEY on the server (32 random bytes, base64) to store them encrypted from this page, or set {fields.filter(([, f]) => f.required).map(([, f]) => f.env).join(' and ')} as environment variables.</p>
        </Notice>
      )}
      {status.storedUnreadable && (
        <Notice tone="warning" title="Stored credentials cannot be read.">
          <p>They were encrypted with a different SMS_CREDENTIALS_KEY. Enter them again, or restore the key.</p>
        </Notice>
      )}
      <form className="fx-stack fx-stack--sm" autoComplete="off" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="es-smsform">
          {fields.map(([name, f]) => (
            <Field
              key={name}
              label={f.label}
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              optional={!f.required}
              disabled={!status.keyConfigured || busy !== null}
              placeholder={f.source ? (f.secret ? '•••••••• (set)' : `${f.hint || 'set'}`) : ''}
              hint={f.source ? `${SOURCE[f.source]}${f.source === 'env' ? ' — overrides anything stored here' : ''}` : `Not set · ${f.env}`}
              value={values[name] || ''}
              onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
            />
          ))}
        </div>
        <div className="fx-row gap-2">
          <button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={!status.keyConfigured || !typed || busy !== null}>Save encrypted</button>
          <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busy !== null || (!typed && !status.configured)} onClick={runTest}>
            {typed ? 'Test what I typed' : 'Test connection'}
          </button>
          {status.configured && <button type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={busy !== null} onClick={loadNumbers}>Find numbers</button>}
          {status.stored && <button type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={busy !== null} onClick={remove}>Remove stored</button>}
        </div>
      </form>
      {(test || provider.lastTest) && (() => {
        const t = test || provider.lastTest;
        return (
          <p role="status" className={`text-sm ${t.ok ? 'text-success' : 'text-danger'}`}>
            {t.ok ? 'Connected' : 'Not connected'}
            {t.account ? ` · ${t.account}` : ''}{t.balance != null ? ` · balance ${t.balance} ${t.currency || ''}` : ''}
            {!t.ok && (t.error || t.detail) ? ` · ${t.error || t.detail}` : ''}
            {t.at ? ` · ${new Date(t.at).toLocaleString()}` : ''}
          </p>
        );
      })()}
      {numbers && (
        <div className="fx-stack fx-stack--sm rounded-(--es-radius-md) bg-bg-sunken p-3">
          {numbers.length === 0 ? <p className="text-sm text-muted">No numbers on this account.</p> : numbers.map((n) => (
            <label key={n.value} className="es-smscheck">
              <input type="checkbox" disabled={n.imported || !n.sms} checked={Boolean(picked[n.value])} onChange={(e) => setPicked((p) => ({ ...p, [n.value]: e.target.checked }))} />
              <span>{n.value} <span className="text-subtle">· {n.kind.replace('_', ' ')}{n.label ? ` · ${n.label}` : ''}{n.imported ? ' · already a sender' : ''}{!n.sms ? ' · no SMS' : ''}</span></span>
            </label>
          ))}
          {numbers.some((n) => !n.imported && n.sms) && (
            <div><button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={busy !== null || !Object.values(picked).some(Boolean)} onClick={importPicked}>Import selected</button></div>
          )}
        </div>
      )}
    </div>
  );
}
