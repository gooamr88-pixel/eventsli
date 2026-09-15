'use client';

import { useState } from 'react';
import { patch } from '../../utils/apiClient';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/Confirm';
import { formatEventTime } from '../../lib/eventTime';
import { PageHeader, Panel } from '../../components/ui/Page';
import FormError from '../../components/forms/FormError';
import { Loading, ErrorNotice, Notice } from '../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Platform settings — one typed form per setting.
 *
 * This was a raw JSON box per row, with nothing between a typo and production:
 * `{"default_pct":150}` gave every new event a 150% commission. The API now
 * checks each key against a schema (backend utils/settingsSchema.js) and this
 * page offers only the fields that schema allows, in their units.
 *
 * Every editable key is listed, saved or not. The page used to render only rows
 * that existed, so a database with none showed "No settings are exposed" and no
 * way to open a market — without which no event can be created at all.
 *
 * PATCH is super-admin only, so a plain admin gets a read-only view instead of
 * inputs and a Save that could only return 403. Saving asks for a reason, which
 * goes into the audit log beside the old and new values.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MARKETS = [
  { country: 'CA', name: 'Canada', currency: 'CAD' },
  { country: 'US', name: 'United States', currency: 'USD' },
];

const percent = { unit: '%', step: '0.01', min: 0, max: 100 };
const cents = { unit: 'cents', step: '1', min: 0, max: 10000 };

const FORMS = {
  currencies: {
    title: 'Markets open for new events',
    hint: 'Where organizers can create events. The currency follows the country and cannot be chosen separately.',
  },
  commission: {
    title: 'Commission',
    hint: 'What Eventsli takes on a new event by default. An admin can change it on any single event.',
    fields: [
      { name: 'default_pct', label: 'Commission', ...percent },
      { name: 'default_tax_pct', label: 'Tax on the commission', ...percent },
    ],
  },
  payment_fee: {
    title: 'Payment fee',
    hint: 'The default card fee on a new event.',
    fields: [
      { name: 'default_pct', label: 'Percentage', ...percent },
      { name: 'default_fixed_cents', label: 'Fixed amount', ...cents },
    ],
  },
  stripe_cost: {
    title: 'What a card payment costs Eventsli',
    hint: "Stripe's rate. Fee previews use it to warn when a fee does not cover the cost.",
    fields: [
      { name: 'pct', label: 'Percentage', ...percent },
      { name: 'fixed_cents', label: 'Fixed amount', ...cents },
    ],
  },
  manual_invoice: {
    title: 'Door-sale invoices',
    hint: 'How long an organizer has to pay the commission on door sales.',
    fields: [
      { name: 'due_days', label: 'Days to pay', unit: 'days', step: '1', min: 1, max: 90 },
      { name: 'min_hours_before_event', label: 'Due at least this long before doors', unit: 'hours', step: '1', min: 0, max: 720 },
    ],
  },
};
const ORDER = Object.keys(FORMS);

export default function Settings() {
  const { user } = useAuth();
  const canEdit = Boolean(user?.isSuperAdmin);
  const { data, error, loading, reload } = useApi('/admin/settings');

  const settings = Array.isArray(data)
    ? data.filter((s) => FORMS[s.key]).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
    : [];
  const markets = settings.find((s) => s.key === 'currencies');

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Governance"
        title="Platform settings"
        lede="The markets Eventsli sells in, and the defaults every new event starts from."
      />

      <Notice tone="info" title="Changes apply from now on.">
        <p>They affect events created after the change. Events that already exist keep their own settings, and nothing already sold is rewritten.</p>
      </Notice>

      {!canEdit && (
        <Notice title="Read only">
          <p>Only a super admin can change platform settings.</p>
        </Notice>
      )}

      {markets && !markets.isSet && (
        <Notice tone="danger" title="No market is open.">
          <p>Nobody can create an event until the markets below are saved.</p>
        </Notice>
      )}

      {error ? (
        <ErrorNotice error={error} />
      ) : loading && !data ? (
        <Loading variant="list" rows={4} label="Loading settings" />
      ) : (
        <div className="fx-grid fx-grid--2">
          {settings.map((setting) => (
            // Keyed on the saved value, so a save re-seeds the draft.
            <SettingCard
              key={`${setting.key}:${setting.isSet}:${JSON.stringify(setting.value)}`}
              setting={setting}
              canEdit={canEdit}
              onSaved={reload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SettingCard({ setting, canEdit, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const form = FORMS[setting.key];
  const base = setting.value ?? setting.defaultValue ?? {};
  const [draft, setDraft] = useState(() => initialDraft(setting.key, base));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const value = buildValue(setting.key, base, draft);
  const changed = !setting.isSet || (value !== null && stable(value) !== stable(base));

  async function save(e) {
    e.preventDefault();
    if (value === null) return;
    const closing = setting.key === 'currencies'
      && Object.keys(base.by_country || {}).some((country) => !value.by_country[country]);
    const answer = await confirm({
      title: `Save “${form.title}”?`,
      tone: closing ? 'danger' : 'default',
      body: closing
        ? <p>Organizers in a market you close can no longer create events there. Events that already exist are not affected.</p>
        : <p>New events use this from the moment it is saved.</p>,
      confirmLabel: 'Save setting',
      reason: { label: 'Why is this changing?', minLength: 5, maxLength: 500 },
    });
    if (!answer) return;

    setBusy(true);
    setError(null);
    try {
      await patch(`/admin/settings/${setting.key}`, { value, reason: answer.reason }, { noRedirect: true });
      toast.success(`${form.title} saved.`);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={form.title} action={!setting.isSet && <span className="es-pill es-pill--warning">Not saved yet</span>}>
      <form onSubmit={save} className="fx-stack fx-stack--sm">
        <p className="text-sm text-muted">{form.hint}</p>

        {setting.key === 'currencies' ? (
          <fieldset className="fx-stack fx-stack--sm">
            <legend className="sr-only">Markets</legend>
            {MARKETS.map((m) => (
              <label key={m.country} className="fx-row text-sm text-ink">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--es-accent)]"
                  disabled={!canEdit}
                  checked={draft.includes(m.country)}
                  onChange={(e) => setDraft((d) => (e.target.checked ? [...d, m.country] : d.filter((c) => c !== m.country)))}
                />
                {m.name} — sells in {m.currency}
              </label>
            ))}
          </fieldset>
        ) : canEdit ? (
          <div className="fx-grid fx-grid--2">
            {form.fields.map((f) => {
              const id = `set-${setting.key}-${f.name}`;
              return (
                <div key={f.name} className="fx-stack fx-stack--sm gap-1.5">
                  <label htmlFor={id} className="text-sm text-ink">{f.label} ({f.unit})</label>
                  <input
                    id={id}
                    type="number"
                    inputMode="decimal"
                    step={f.step}
                    min={f.min}
                    max={f.max}
                    required
                    className="es-input"
                    value={draft[f.name]}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.name]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <dl className="fx-stack fx-stack--sm text-sm">
            {form.fields.map((f) => (
              <div key={f.name} className="fx-row fx-row--between border-t border-border-base pt-2 first:border-0 first:pt-0">
                <dt className="text-muted">{f.label}</dt>
                <dd className="es-nums text-ink">{String(base[f.name] ?? '—')} {f.unit}</dd>
              </div>
            ))}
          </dl>
        )}

        <p className="text-xs text-subtle">
          {setting.isSet
            ? `Last changed ${formatEventTime(setting.updatedAt)}`
            : 'Showing the built-in default. Save it to make it the platform setting.'}
        </p>

        {canEdit && value === null && (
          <p className="text-sm text-danger" role="status">
            {setting.key === 'currencies'
              ? 'Open at least one market — with none, no event can be created anywhere.'
              : 'Each value must be a number within its range, and fixed amounts in whole cents or days.'}
          </p>
        )}

        <FormError error={error} />

        {canEdit && (
          <div>
            <button type="submit" disabled={busy || value === null || !changed} className="es-btn es-btn--primary es-btn--sm">
              {busy ? 'Saving…' : setting.isSet ? 'Save' : 'Save these values'}
            </button>
          </div>
        )}
      </form>
    </Panel>
  );
}

function initialDraft(key, base) {
  if (key === 'currencies') return Object.keys(base.by_country || {});
  return Object.fromEntries(FORMS[key].fields.map((f) => [f.name, base[f.name] === undefined ? '' : String(base[f.name])]));
}

/** The value to send, or null when the draft is not valid. */
function buildValue(key, base, draft) {
  if (key === 'currencies') {
    const chosen = MARKETS.filter((m) => draft.includes(m.country));
    if (!chosen.length) return null;
    return {
      allowed: [...new Set(chosen.map((m) => m.currency))].sort(),
      by_country: Object.fromEntries(chosen.map((m) => [m.country, m.currency])),
    };
  }
  // Optional fields the form does not show (payment_fee.default_mode) are kept.
  const value = key === 'payment_fee' && base.default_mode ? { default_mode: base.default_mode } : {};
  for (const f of FORMS[key].fields) {
    const text = String(draft[f.name] ?? '').trim();
    const n = Number(text);
    if (!text || !Number.isFinite(n) || n < f.min || n > f.max) return null;
    if (f.step === '1' && !Number.isInteger(n)) return null;
    value[f.name] = n;
  }
  return value;
}

/** Key order does not make a value different. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
