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
import { MARKET_ROWS as MARKETS } from '../../lib/markets';

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
const percent = { unit: '%', step: '0.01', min: 0, max: 100 };
const cents = { unit: 'cents', step: '1', min: 0, max: 10000 };

const FORMS = {
  // Publish first, review after (2026-11-03). Off: an organizer's Publish puts
  // the event live and every admin is emailed to review it. On: it waits in
  // the approval queue until an admin approves it.
  event_publishing: {
    title: 'Publishing events',
    hint: 'Off: organizers publish immediately and every admin is emailed to review the new event afterwards. On: events wait in the approval queue until an admin approves them.',
    fields: [
      { name: 'require_approval', label: 'Review events before they go live', type: 'boolean' },
    ],
  },
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
    hint: 'How long an organizer has to pay the commission on door sales, and how they pay it.',
    fields: [
      { name: 'due_days', label: 'Days to pay', unit: 'days', step: '1', min: 1, max: 90 },
      { name: 'min_hours_before_event', label: 'Due at least this long before doors', unit: 'hours', step: '1', min: 0, max: 720 },
      // Printed on every invoice email and the organizer's Commission page.
      // Without it an organizer is told to pay by transfer and never told where.
      {
        name: 'payment_instructions', label: 'How organizers pay Eventsli', type: 'text', maxLength: 1000, optional: true,
        placeholder: 'e.g. Bank transfer to Eventsli Inc. — account, transit and institution numbers, or an e-transfer address.',
        hint: 'Bank or e-transfer details. The invoice number is added as the payment reference.',
      },
      // Enforcement — read by the database's gate check, so every door applies
      // it. An admin's per-event Keep open / Keep closed outranks all of these.
      { name: 'enforce_gate', label: 'An overdue invoice switches scanning off', type: 'boolean', default: true },
      { name: 'grace_hours', label: 'Grace after the due date', unit: 'hours', step: '1', min: 0, max: 168, default: 0 },
      { name: 'pause_on_receipt', label: 'A receipt waiting for review keeps scanning on', type: 'boolean', default: false },
      { name: 'reminder_hours_before_due', label: 'Reminder before the due date (0 = none)', unit: 'hours', step: '1', min: 0, max: 336, default: 48 },
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
        icon="settings"
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
        <ErrorNotice error={error} onRetry={reload} />
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
        : setting.key === 'event_publishing'
          ? <p>Applies to the next event an organizer publishes. Events already live are not affected.</p>
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
          // Not .fx-grid--2: its 560px track never fits this half-width card, so it
          // was one column, and the textarea's col-span-2 then added an implicit
          // second column that the next fields flowed into, past the card's edge.
          <div className="es-dgrid">
            {form.fields.map((f) => {
              const id = `set-${setting.key}-${f.name}`;
              if (f.type === 'boolean') {
                return (
                  <label key={f.name} htmlFor={id} className="fx-row items-center gap-2 text-sm text-ink">
                    <input
                      id={id} type="checkbox" className="size-5 accent-[var(--es-accent)]"
                      checked={draft[f.name] === 'true'}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.name]: String(e.target.checked) }))}
                    />
                    {f.label}
                  </label>
                );
              }
              if (f.type === 'text') {
                return (
                  <div key={f.name} className="fx-stack fx-stack--sm gap-1.5 md:col-span-2">
                    <label htmlFor={id} className="text-sm text-ink">{f.label}{f.optional ? ' (optional)' : ''}</label>
                    <textarea
                      id={id}
                      rows={4}
                      maxLength={f.maxLength}
                      className="es-input py-2"
                      placeholder={f.placeholder}
                      aria-describedby={f.hint ? `${id}-hint` : undefined}
                      value={draft[f.name]}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.name]: e.target.value }))}
                    />
                    {f.hint && <p id={`${id}-hint`} className="text-xs text-subtle">{f.hint}</p>}
                  </div>
                );
              }
              return (
                // justify-end: a two-line label beside a one-line one keeps the inputs level.
                <div key={f.name} className="fx-stack fx-stack--sm justify-end gap-1.5">
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
                <dd className="es-nums text-ink">
                  {f.type === 'boolean' ? ((base[f.name] ?? f.default) ? 'On' : 'Off')
                    : f.type === 'text' ? <span className="whitespace-pre-line">{base[f.name] || 'Not set'}</span>
                      : `${String(base[f.name] ?? f.default ?? '—')} ${f.unit}`}
                </dd>
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
  // A field added after the setting was first saved starts at its default,
  // which is also what the server falls back to — never at a blank or "off".
  return Object.fromEntries(FORMS[key].fields.map((f) => {
    const v = base[f.name] === undefined ? f.default : base[f.name];
    return [f.name, v === undefined ? '' : String(v)];
  }));
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
  // Optional fields the form does not show are kept: payment_fee.default_mode,
  // and manual_invoice.min_hours_from_issue, which the due-date trigger reads.
  const value = key === 'payment_fee' && base.default_mode ? { default_mode: base.default_mode } : {};
  if (key === 'manual_invoice' && base.min_hours_from_issue !== undefined) value.min_hours_from_issue = base.min_hours_from_issue;
  for (const f of FORMS[key].fields) {
    if (f.type === 'boolean') { value[f.name] = draft[f.name] === 'true'; continue; }
    if (f.type === 'text') {
      const text = String(draft[f.name] ?? '').trim();
      if (text.length > f.maxLength) return null;
      if (text) value[f.name] = text;
      continue;
    }
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
