'use client';

import { useState } from 'react';
import Link from 'next/link';
import { post, del } from '../../../../utils/apiClient';
import { messageFor } from '../../../../utils/errors';
import { formatEventTime } from '../../../../lib/eventTime';
import { useApi } from '../../../../hooks/useApi';
import { useToast } from '../../../../components/ui/Toast';
import { useConfirm } from '../../../../components/ui/Confirm';
import { Panel } from '../../../../components/ui/Page';
import DataTable from '../../../../components/ui/DataTable';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import { Loading, Empty, ErrorNotice } from '../../../../components/Feedback';
import { useEventContext } from '../EventContext';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The door team: named people, with their own Eventsli accounts, who may scan
 * this event and nothing else.
 *
 * Beside the PIN devices, not instead of them. A shared tablet with a PIN is
 * still right for volunteers on a rota; a named account is right for someone who
 * has to be accountable for who they let in — every scan they make carries
 * their account.
 *
 * ADDING SOMEONE ANSWERS THE SAME WAY WHETHER OR NOT THE ADDRESS HAS AN ACCOUNT,
 * and never with their name. Anyone can become an organizer, and a "no such
 * account" here was a free way to find out who uses Eventsli. So the list shows
 * the addresses typed, and someone who does not appear needs an account first.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function DoorTeam({ eventId }) {
  const toast = useToast();
  const confirm = useConfirm();
  const timezone = useEventContext()?.event?.timezone;
  const { data, error, loading, reload } = useApi(`/events/${eventId}/staff`);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const result = await post(`/events/${eventId}/staff`, { email: email.trim() }, { noRedirect: true });
      toast.success(
        result?.message || 'If that address has an Eventsli account, they are on the door team now.',
        { title: 'Request sent' },
      );
      setEmail('');
      reload();
    } catch (err) {
      setFormError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(member) {
    const ok = await confirm({
      title: `Remove ${member.email}?`,
      body: <p>Their next scan is refused. Scans they already made stay on record.</p>,
      confirmLabel: 'Remove from the team',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await del(`/events/${eventId}/staff/${member.id}`, { noRedirect: true });
      toast.success(`${member.email} was removed.`);
      reload();
    } catch (err) {
      toast.error(messageFor(err));
    }
  }

  const members = Array.isArray(data) ? data : [];

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl text-ink">Door team</h2>
        <p className="max-w-[62ch] text-muted">
          People who scan tickets with their own account. They can only scan this event — no orders,
          no money, no dashboard.{' '}
          <Link href={`/organizer/events/${eventId}/devices`} className="text-accent">
            Shared tablets with a PIN
          </Link>{' '}
          still work alongside them.
        </p>
      </div>

      <div className="grid gap-[var(--fx-gap)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Add someone">
          <form onSubmit={add} className="fx-stack fx-stack--sm">
            <Field
              label="Their Eventsli account email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              hint="They need an Eventsli account with this address. For their privacy we answer the same either way — if they do not appear below, ask them to create one."
            />
            <FormError error={formError} />
            <div>
              <SubmitButton busy={busy} busyLabel="Adding…">Add to the door team</SubmitButton>
            </div>
          </form>
        </Panel>

        <Panel title="How they sign in">
          <ol className="fx-stack fx-stack--sm list-decimal pl-5 text-sm text-muted">
            <li>On the phone or tablet they will scan with, they open <span className="font-mono text-ink">/gate/login</span>.</li>
            <li>They choose <span className="text-ink">Sign in with my account</span> and pick this event.</li>
            <li>They stay signed in for one shift — sixteen hours — and then sign in again.</li>
          </ol>
        </Panel>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading variant="list" rows={2} label="Loading the door team" />
      ) : members.length === 0 ? (
        <Empty title="Nobody on the door team yet." hint="Add someone above, or use a shared tablet with a PIN." />
      ) : (
        <DataTable
          caption="Door team"
          rows={members}
          columns={[
            {
              key: 'person',
              label: 'Account',
              primary: true,
              render: (m) => <span className="fx-break text-ink">{m.email}</span>,
            },
            {
              key: 'status',
              label: 'Status',
              render: (m) => (
                <span className={`es-pill ${m.active ? 'es-pill--accent' : ''}`}>{m.active ? 'Can scan' : 'Removed'}</span>
              ),
            },
            {
              key: 'seen',
              label: 'Last signed in',
              render: (m) => (m.lastSignInAt ? formatEventTime(m.lastSignInAt, timezone) : 'Not yet'),
            },
            {
              key: 'actions',
              label: 'Actions',
              hideLabel: true,
              align: 'end',
              render: (m) => (m.active ? (
                <button type="button" onClick={() => remove(m)} className="es-btn es-btn--ghost es-btn--sm">
                  Remove
                </button>
              ) : null),
            },
          ]}
        />
      )}
    </div>
  );
}
