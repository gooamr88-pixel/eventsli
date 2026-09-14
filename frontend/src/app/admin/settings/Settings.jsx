'use client';

import { useState } from 'react';
import { patch } from '../../utils/apiClient';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../components/ui/Toast';
import { PageHeader, Panel } from '../../components/ui/Page';
import FormError from '../../components/forms/FormError';
import { Loading, Empty, ErrorNotice, Notice } from '../../components/Feedback';

/**
 * Platform settings.
 *
 * The API keeps an allowlist of editable keys and refuses anything else, so
 * this page renders whatever it is given rather than hard-coding a list that
 * would drift. A key the server does not consider editable is refused on save
 * with its reason, which is more honest than hiding it.
 *
 * Values are JSON, because that is what the column holds.
 */
export default function Settings() {
  const { data, error, loading, reload } = useApi('/admin/settings');

  const keys = data ? Object.keys(data).sort() : [];

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Console"
        title="Platform settings"
        lede="Defaults that apply where an event does not set its own."
      />

      <Notice tone="info" title="Changes apply from now on.">
        <p>They affect events created after the change. Nothing already sold is rewritten.</p>
      </Notice>

      {error ? (
        <ErrorNotice error={error} />
      ) : loading && !data ? (
        <Loading variant="list" rows={4} label="Loading settings" />
      ) : keys.length === 0 ? (
        <Empty title="No settings are exposed." hint="The API decides which keys can be edited here." />
      ) : (
        <div className="fx-grid fx-grid--2">
          {keys.map((key) => (
            // Keyed on the value too, so a saved change re-seeds the draft.
            <SettingCard key={`${key}:${JSON.stringify(data[key])}`} settingKey={key} value={data[key]} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function SettingCard({ settingKey, value, onChanged }) {
  const toast = useToast();
  const current = stringify(value);
  const [draft, setDraft] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const changed = draft !== current;
  const malformed = changed && parse(draft) === undefined;
  const inputId = `set-${settingKey}`;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await patch(`/admin/settings/${encodeURIComponent(settingKey)}`, { value: parse(draft) }, { noRedirect: true });
      toast.success(`${settingKey} saved.`);
      onChanged();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Panel>
      <form onSubmit={save} className="fx-stack fx-stack--sm">
        <label htmlFor={inputId} className="font-mono text-sm text-ink">{humanKey(settingKey)}</label>
        <input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-invalid={malformed || undefined}
          aria-describedby={`${inputId}-hint`}
          spellCheck={false}
          className="es-input font-mono"
        />
        <p id={`${inputId}-hint`} className={`text-xs ${malformed ? 'text-danger' : 'text-subtle'}`}>
          {malformed
            ? <>Not valid JSON. Text needs quotes: <code>&quot;value&quot;</code></>
            : <>Stored as JSON · key <code>{settingKey}</code></>}
        </p>

        <FormError error={error} />

        {changed && (
          <div className="fx-row fx-row--between">
            <button type="button" onClick={() => { setDraft(current); setError(null); }} className="es-btn es-btn--ghost es-btn--sm">
              Undo
            </button>
            <button type="submit" disabled={busy || malformed} className="es-btn es-btn--primary es-btn--sm">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </form>
    </Panel>
  );
}

/** `default_commission_pct` → "Default commission pct". The raw key stays visible under the field. */
function humanKey(key) {
  return key.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());
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
