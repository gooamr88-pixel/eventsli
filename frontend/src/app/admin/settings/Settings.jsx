'use client';

import { useEffect, useState } from 'react';
import { get, patch } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import FormError from '../../components/forms/FormError';

/**
 * Platform settings.
 *
 * The API keeps an allowlist of editable keys and refuses anything else, so
 * this page renders whatever it is given rather than hard-coding a list that
 * would drift. A key the server does not consider editable is shown read-only,
 * which is more honest than hiding it — an admin looking for it should find it
 * and see that it is not theirs to change here.
 *
 * Values are JSON, because that is what the column holds.
 */
export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/admin/settings', { cache: 'no-store' });
        if (!cancelled) { setSettings(data || {}); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  if (error) return <p className="text-sm text-muted">{describeError(error).recovery}</p>;
  if (!settings) return <p className="text-sm text-subtle">Loading…</p>;

  const keys = Object.keys(settings).sort();

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl">Platform settings</h2>
        <p className="max-w-[62ch] text-muted">
          Defaults that apply where an event does not set its own. Changing one affects
          events created from now on — it does not rewrite anything already sold.
        </p>
      </div>

      {keys.length === 0 ? (
        <p className="text-sm text-muted">No settings are exposed.</p>
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {keys.map((key) => (
            <SettingRow
              key={key}
              settingKey={key}
              value={settings[key]}
              onChanged={() => setReload((n) => n + 1)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SettingRow({ settingKey, value, onChanged }) {
  const [draft, setDraft] = useState(() => stringify(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const current = stringify(value);
  const changed = draft !== current;
  const malformed = changed && parse(draft) === undefined;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await patch(`/admin/settings/${encodeURIComponent(settingKey)}`, {
        value: parse(draft),
      }, { noRedirect: true });
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="fx-stack fx-stack--sm rounded-[--es-radius-lg] border border-border-base bg-surface p-4">
      <form onSubmit={save} className="fx-stack fx-stack--sm">
        <label htmlFor={`set-${settingKey}`} className="font-mono text-sm text-ink">
          {settingKey}
        </label>
        <input
          id={`set-${settingKey}`}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
          className={`rounded-[--es-radius-md] border bg-bg px-3 py-2 font-mono text-sm text-ink ${
            malformed ? 'border-danger' : 'border-border-strong'
          }`}
        />
        {malformed && (
          <p className="text-xs text-danger">
            Not valid JSON. Strings need quotes: <code>&quot;value&quot;</code>
          </p>
        )}
        {saved && <p className="text-xs text-accent">Saved.</p>}

        <FormError error={error} />

        {changed && (
          <div className="fx-row fx-row--between">
            <button
              type="button"
              onClick={() => { setDraft(current); setError(null); }}
              className="text-sm text-muted hover:text-ink"
            >
              Undo
            </button>
            <button
              type="submit"
              disabled={busy || malformed}
              className="rounded-[--es-radius-md] bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </form>
    </li>
  );
}

/** The column is JSONB, so a value round-trips as JSON. A bare string is shown
 *  quoted rather than raw, because that is what has to be typed back. */
function stringify(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** `undefined` means "not valid JSON" — distinct from `null`, which is a
 *  perfectly good value to store. */
function parse(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}
