'use client';

import { useState } from 'react';
import { put } from '../../utils/apiClient';
import { useApi } from '../../hooks/useApi';
import { PageHeader, Panel } from '../../components/ui/Page';
import Field from '../../components/forms/Field';
import FormError from '../../components/forms/FormError';
import SubmitButton from '../../components/forms/SubmitButton';
import { Loading, ErrorNotice, Notice } from '../../components/Feedback';
import { consentText } from '../../lib/smsConsentText';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A person's own text message preferences.
 *
 * Two independent answers — texts about MY tickets and events, and Eventsli
 * offers — plus every organizer they agreed to hear from at a checkout, each
 * withdrawable here. Opting IN to an organizer happens at that organizer's
 * checkout, where the person sees who they are agreeing to.
 *
 * A STOP reply outranks this page: a number on the suppression list gets
 * nothing until its owner replies START, and the page says so instead of
 * showing switches that would not work.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const STATUS = { opted_in: 'On', pending: 'Waiting for your YES reply', opted_out: 'Off' };

const SUPPRESSED = {
  stop_keyword: { title: 'This number replied STOP.', body: 'We send it nothing at all until you reply START to any Eventsli text. Carriers enforce this, so it comes before the switches below.' },
  carrier_opt_out: { title: 'Your mobile carrier has this number opted out.', body: 'Reply START to any Eventsli text to resume.' },
  opt_out_link: { title: 'You unsubscribed from offers by link.', body: 'Offers stay off for this number. Texts about your tickets are not affected.' },
  invalid_number: { title: 'Texts to this number could not be delivered.', body: 'Check the number below; contact support once it is correct.' },
};

function Preferences({ initial, onSaved, saved }) {
  const [phone, setPhone] = useState(initial.phone || '');
  const [transactional, setTransactional] = useState(initial.transactional?.status === 'opted_in');
  const [marketing, setMarketing] = useState(['opted_in', 'pending'].includes(initial.marketing?.status));
  const [withdraw, setWithdraw] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await put('/sms/preferences', {
        phone: phone.trim(), transactional, marketing,
        organizers: Object.entries(withdraw).filter(([, v]) => v).map(([organizerId]) => ({ organizerId, marketing: false })),
      }, { noRedirect: true });
      setWithdraw({});
      onSaved(result, result.confirmationSent
        ? 'Saved. We sent a text: reply YES to start receiving offers.'
        : 'Your text message preferences are saved.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const organizers = (initial.organizers || []).filter((o) => o.status !== 'opted_out');

  return (
    <form onSubmit={save} className="fx-stack">
      {initial.suppression && (
        <Notice tone="warning" title={SUPPRESSED[initial.suppression.reason]?.title || 'Texts to this number are stopped.'}>
          <p>{SUPPRESSED[initial.suppression.reason]?.body || 'Contact Eventsli support if you think this is a mistake.'}</p>
        </Notice>
      )}
      <Field label="Mobile number" type="tel" autoComplete="tel" inputMode="tel" required value={phone}
        onChange={(e) => setPhone(e.target.value)} hint="With its country code, starting with + (for example +1 416 555 0199)." />

      <fieldset className="fx-stack fx-stack--sm">
        <legend className="mb-1 text-sm font-medium text-ink">From Eventsli</legend>
        <label className="flex items-start gap-2.5 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 shrink-0" checked={transactional} onChange={(e) => setTransactional(e.target.checked)} />
          <span>{consentText('account.transactional.v1')}<span className="block text-xs text-subtle">Now: {STATUS[initial.transactional?.status] || 'Off'}</span></span>
        </label>
        <label className="flex items-start gap-2.5 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 shrink-0" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
          <span>{consentText('account.marketing.v1')}<span className="block text-xs text-subtle">Now: {STATUS[initial.marketing?.status] || 'Off'}</span></span>
        </label>
      </fieldset>

      {organizers.length > 0 && (
        <fieldset className="fx-stack fx-stack--sm">
          <legend className="mb-1 text-sm font-medium text-ink">Organizers you agreed to hear from</legend>
          {organizers.map((o) => (
            <label key={o.organizerId} className="flex items-start gap-2.5 text-sm text-ink">
              <input type="checkbox" className="mt-0.5 shrink-0" checked={!withdraw[o.organizerId]}
                onChange={(e) => setWithdraw((w) => ({ ...w, [o.organizerId]: !e.target.checked }))} />
              <span>News and offers from {o.name}<span className="block text-xs text-subtle">{STATUS[o.status]}{o.updatedAt ? ` since ${new Date(o.updatedAt).toLocaleDateString()}` : ''}</span></span>
            </label>
          ))}
          <p className="text-xs text-subtle">Untick to stop. To hear from an organizer again, tick their box at your next checkout.</p>
        </fieldset>
      )}

      <FormError error={error} />
      {saved && <p role="status" className="text-sm text-success">{saved}</p>}
      <div><SubmitButton busy={busy} busyLabel="Saving…">Save preferences</SubmitButton></div>
      <p className="text-xs text-subtle">You can also reply STOP to any text to stop everything from that number, or HELP for help. Msg &amp; data rates may apply.</p>
    </form>
  );
}

/** Changes whenever the server's answer changes, so the form re-reads it (and only then). */
const stateKey = (p) => [p.phone, p.transactional?.status, p.transactional?.updatedAt, p.marketing?.status, p.marketing?.updatedAt,
  (p.organizers || []).map((o) => `${o.organizerId}:${o.status}`).join(','), p.suppression?.reason || ''].join('|');

export default function TextMessages() {
  const { data, error, loading, reload } = useApi('/sms/preferences');
  // The save answers with the fresh preferences: the form re-initialises from
  // THAT, not from the earlier load (which would show the old ticks).
  const [latest, setLatest] = useState(null);
  const [saved, setSaved] = useState(null);
  const prefs = latest || data;
  return (
    <div className="fx-stack">
      <PageHeader eyebrow="Your account" title="Text messages"
        lede="Choose which texts you get. Texts about your tickets and offers are separate choices." />
      <Panel icon="chat" title="Preferences">
        {error ? <ErrorNotice error={error} onRetry={reload} /> : !prefs ? <Loading variant="list" rows={3} label="Loading preferences" />
          : <Preferences key={stateKey(prefs)} initial={prefs} saved={saved} onSaved={(fresh, message) => { setLatest(fresh); setSaved(message); }} />}
      </Panel>
    </div>
  );
}
