'use client';

import { useState } from 'react';
import { Panel } from '../../../../components/ui/Page';
import { Loading, Empty, Notice } from '../../../../components/Feedback';
import FormError from '../../../../components/forms/FormError';
import { useConfirm } from '../../../../components/ui/Confirm';
import { useToast } from '../../../../components/ui/Toast';
import { useContentSection, useSectionDraft } from './useContentSection';
import SaveBar from './SaveBar';
import RowControls from './RowControls';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The organizer's own policies for this event.
 *
 * THESE ARE NOT EVENTSLI'S TERMS. The platform's terms are what the organizer
 * accepted in order to publish, and what the buyer accepts at the checkout;
 * these sit alongside and cover what only the organizer can decide — refunds,
 * age limits, what may be brought in. The panel says so, because an organizer
 * who thinks they are editing the platform's terms will write something that
 * contradicts them.
 *
 * "SHOW AT CHECKOUT" IS THE SETTING THAT MATTERS. A refund policy nobody saw
 * before paying is a refund policy that gets argued about afterwards, and the
 * argument lands on the organizer. It defaults to on for refunds and off for
 * everything else, because that is the one people are surprised by.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const KINDS = [
  ['refund', 'Refunds & cancellations'],
  ['terms', 'Terms & conditions'],
  ['privacy', 'Privacy'],
  ['other', 'Something else'],
];

const KIND_LABEL = Object.fromEntries(KINDS);

export default function PoliciesEditor({ eventId }) {
  const { items, error, busy, add, edit, remove, move, setError } = useContentSection(eventId, 'policies');
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState({ kind: 'refund', title: '', body: '' });

  /**
   * Pending edits to SAVED policies. `draft` above is the blank add-form —
   * a different thing with the same name in English.
   *
   * `kind` is deliberately NOT in here: it is a `<select>`, and choosing from
   * one is a single deliberate act whose result is visible, like add and
   * remove. It stays immediate.
   */
  const rows = useSectionDraft({
    items,
    edit: (id, patch) => edit(id, {
      ...(patch.title !== undefined ? { title: String(patch.title || '').trim() } : {}),
      ...(patch.body !== undefined ? { body: String(patch.body || '').trim() } : {}),
    }),
  });

  async function submit(e) {
    e.preventDefault();
    if (!draft.title.trim() || !draft.body.trim()) return;
    const { ok } = await add({
      kind: draft.kind,
      title: draft.title.trim(),
      body: draft.body.trim(),
      // Refunds are what a buyer needs before paying, not after.
      showAtCheckout: draft.kind === 'refund',
    });
    if (ok) {
      setDraft({ kind: 'refund', title: '', body: '' });
      toast.success('Policy added.');
    }
  }

  async function removePolicy(policy) {
    const ok = await confirm({
      title: `Remove "${policy.title}"?`,
      tone: 'danger',
      body: <p>It comes off your event page, and off the checkout if it was shown there.</p>,
      confirmLabel: 'Remove policy',
    });
    if (ok) remove(policy.id);
  }

  return (
    <Panel
      title="Event policies"
      description="Your rules for this event — refunds, age limits, what people can bring."
    >
      <Notice tone="neutral" title="These are your policies, not Eventsli's.">
        <p>
          Eventsli&apos;s terms still apply to every sale and are accepted separately at the
          checkout. Use these for the things only you decide.
        </p>
      </Notice>

      <FormError error={error} />

      {items === null ? (
        <Loading variant="list" rows={2} label="Loading policies" />
      ) : items.length === 0 ? (
        <Empty
          title="No policies yet"
          hint="A refund policy is the one buyers look for. Without it, every question comes to you by email."
        />
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {items.map((policy, index) => (
            <li key={policy.id} className="fx-stack fx-stack--sm rounded-(--es-radius-md) border border-border-base p-3">
              <div className="fx-row flex-wrap items-end gap-2">
                <label className="fx-stack fx-stack--sm fx-min0 flex-1 gap-1">
                  <span className="text-xs text-subtle">Heading</span>
                  {/* Held as a draft and saved on the button below — these
                      were `defaultValue` + `onBlur`, which wrote on every tab
                      through the row and never said whether it had worked. */}
                  <input
                    className="es-input es-input--sm"
                    value={rows.valueOf(policy, 'title')}
                    maxLength={120}
                    onChange={(e) => rows.setField(policy.id, 'title', e.target.value)}
                  />
                </label>
                <label className="fx-stack fx-stack--sm gap-1">
                  <span className="text-xs text-subtle">Kind</span>
                  <select
                    className="es-input es-input--sm w-auto"
                    value={policy.kind}
                    onChange={(e) => edit(policy.id, { kind: e.target.value })}
                  >
                    {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>

              <label className="fx-stack fx-stack--sm gap-1">
                <span className="text-xs text-subtle">{KIND_LABEL[policy.kind] || 'Policy'}</span>
                <textarea
                  className="es-input"
                  rows={5}
                  value={rows.valueOf(policy, 'body')}
                  maxLength={20000}
                  onChange={(e) => rows.setField(policy.id, 'body', e.target.value)}
                />
              </label>

              <label className="fx-row items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={policy.showAtCheckout}
                  onChange={(e) => edit(policy.id, { showAtCheckout: e.target.checked })}
                />
                <span>
                  <span className="block text-ink">Show this at the checkout</span>
                  <span className="block text-xs text-subtle">
                    Buyers read it before they pay, not after they ask.
                  </span>
                </span>
              </label>

              <RowControls
                index={index}
                total={items.length}
                busy={busy}
                label="policy"
                onMove={(delta) => move(policy.id, delta)}
                onRemove={() => removePolicy(policy)}
              />
            </li>
          ))}
        </ul>
      )}

      <SaveBar
        dirty={rows.dirty}
        status={rows.status}
        failure={rows.failure}
        onSave={rows.save}
        onDiscard={rows.discard}
        label="policy changes"
      />

      <form onSubmit={submit} className="fx-stack fx-stack--sm border-t border-border-base pt-4">
        <div className="fx-row flex-wrap items-end gap-2">
          <label className="fx-stack fx-stack--sm gap-1">
            <span className="text-sm text-ink">Kind</span>
            <select
              className="es-input w-auto"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            >
              {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="fx-stack fx-stack--sm fx-min0 flex-1 gap-1">
            <span className="text-sm text-ink">Heading</span>
            <input
              className="es-input" required maxLength={120}
              placeholder={KIND_LABEL[draft.kind]}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
        </div>

        <label className="fx-stack fx-stack--sm gap-1">
          <span className="text-sm text-ink">What it says</span>
          <textarea
            className="es-input" rows={4} required maxLength={20000}
            placeholder="Refunds up to 7 days before the event. After that, tickets can be transferred but not refunded."
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
        </label>

        <button
          type="submit"
          disabled={busy || !draft.title.trim() || !draft.body.trim()}
          className="es-btn es-btn--secondary self-start"
        >
          Add policy
        </button>
      </form>
    </Panel>
  );
}
