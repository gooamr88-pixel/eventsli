'use client';

import { useState } from 'react';
import { post, patch } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { useAuth } from '../../hooks/useAuth';
import { useApi } from '../../hooks/useApi';
import { useUrlFilters } from '../../hooks/useUrlFilters';
import { ROLES, roleLabel, actRefusal, canAssign, REFUSAL } from '../../lib/roleLadder';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/Confirm';
import { PageHeader } from '../../components/ui/Page';
import { Segmented, SearchBox, Pagination } from '../../components/ui/Filters';
import DataTable from '../../components/ui/DataTable';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';
import { useOrganizerBan } from '../organizers/useOrganizerBan';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * People, and the ladder that governs what can be done to them (BRD §19).
 *
 * FOUR RULES, all enforced by the API (backend utils/roleLadder.js) and all
 * RENDERED HERE AS REASONS rather than discovered as a 403:
 *
 *   1. Nobody acts on themselves. An admin who could edit their own role is not
 *      constrained by roles at all.
 *   2. Nobody acts on a superior, and only a super admin acts on an equal. One
 *      compromised admin cannot disable every other admin; a compromised super
 *      admin CAN be removed by another, without a SQL console.
 *   3. Only a super admin grants a staff role, or `admin` is a role that mints
 *      more of itself.
 *   4. The last super admin cannot be demoted or blocked. Not "should not": the
 *      platform becomes unadministrable with no way back. Rule 2 is what makes
 *      this one reachable.
 *
 * The UI disables what it can predict and explains why on the row. It does NOT
 * treat that as the enforcement — rule 4 depends on a count only the server
 * has, so the API's refusal is still the one that matters and it is shown in
 * full when it comes.
 *
 * Filters live in the URL, so "Blocked accounts" can be linked to and the back
 * button returns to it. Banning an organizer is the same control the
 * Organizers page uses (useOrganizerBan).
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STANDING = [
  { value: '', label: 'Any status' },
  { value: 'false', label: 'Can sign in' },
  { value: 'true', label: 'Blocked' },
];

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { get, set, page } = useUrlFilters();
  const [busyId, setBusyId] = useState(null);

  const role = get('role');
  const blocked = get('blocked');
  const q = get('q');

  const query = new URLSearchParams({ limit: '25', page: String(page) });
  if (q) query.set('q', q);
  if (role) query.set('role', role);
  if (blocked) query.set('blocked', blocked);
  const { data, error, loading, reload } = useApi(`/admin/users?${query}`, { raw: true });
  const rows = data?.data || [];
  const ban = useOrganizerBan(reload);

  async function act(row, { path, body, method = 'post', done }) {
    setBusyId(row.id);
    try {
      if (method === 'patch') await patch(path, body, { noRedirect: true });
      else await post(path, body, { noRedirect: true });
      toast.success(done);
      reload();
    } catch (err) {
      // The API's refusal in full — "You cannot grant a role above your own" —
      // as the header comment promises, not the generic recovery line.
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(row, next) {
    if (next === row.role) return;
    const ok = await confirm({
      title: `Make ${row.email} ${roleLabel(next).toLowerCase()}?`,
      body: <p>They move from {roleLabel(row.role).toLowerCase()} to {roleLabel(next).toLowerCase()} the next time they load a page. The change is kept in the audit log.</p>,
      confirmLabel: 'Change role',
    });
    if (ok) act(row, { path: `/admin/users/${row.id}/role`, body: { role: next }, method: 'patch', done: `${row.email} is now ${roleLabel(next).toLowerCase()}.` });
  }

  async function toggleBlock(row) {
    if (row.isBlocked) {
      const ok = await confirm({ title: `Unblock ${row.email}?`, body: <p>They can sign in again straight away.</p>, confirmLabel: 'Unblock' });
      if (ok) act(row, { path: `/admin/users/${row.id}/unblock`, done: `${row.email} is unblocked.` });
      return;
    }
    const answer = await confirm({
      title: `Block ${row.email}?`,
      body: <p>Blocking ends every one of their sessions immediately. Tickets they hold stay valid.</p>,
      confirmLabel: 'Block the account',
      tone: 'danger',
      reason: { label: 'Why is this account being blocked?', minLength: 5 },
    });
    if (answer) act(row, { path: `/admin/users/${row.id}/block`, body: { reason: answer.reason }, done: `${row.email} is blocked.` });
  }

  return (
    <div className="fx-stack">
      <PageHeader eyebrow="People" title="Accounts" lede="Everyone with an account, their role, and whether they can sign in or sell." />

      <div className="fx-stack fx-stack--sm">
        <div className="fx-row">
          <Segmented label="Role" value={role} onChange={(v) => set('role', v)} options={[{ value: '', label: 'Everyone' }, ...ROLES]} />
          <Segmented label="Status" value={blocked} onChange={(v) => set('blocked', v)} options={STANDING} />
        </div>
        <SearchBox label="Search accounts" placeholder="Name or email" value={q} onSearch={(v) => set('q', v)} />
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading variant="list" rows={5} label="Loading accounts" />
      ) : rows.length === 0 ? (
        <Empty title="Nobody matches." hint="Try another filter. Search matches part of an email or a name." />
      ) : (
        <>
          <DataTable
            caption="Accounts"
            rows={rows}
            columns={[
              {
                key: 'person',
                label: 'Person',
                primary: true,
                render: (r) => (
                  <span className="fx-stack fx-stack--sm gap-0.5">
                    <span className="fx-break text-ink">
                      {r.fullName || 'Unnamed'}
                      {me?.id === r.id && <span className="text-accent"> · you</span>}
                    </span>
                    <span className="fx-break text-sm text-muted">{r.email}</span>
                  </span>
                ),
              },
              { key: 'role', label: 'Role', render: (r) => <RoleCell row={r} me={me} busy={busyId === r.id} onChange={changeRole} /> },
              {
                key: 'status',
                label: 'Status',
                render: (r) => (
                  <span className="fx-row gap-1">
                    {r.isBlocked ? <span className="es-pill es-pill--danger">Blocked</span> : <span className="es-pill es-pill--accent">Active</span>}
                    {r.organizer?.isBanned && <span className="es-pill es-pill--danger">Banned from selling</span>}
                  </span>
                ),
              },
              {
                key: 'actions',
                label: 'Actions',
                hideLabel: true,
                align: 'end',
                render: (r) => {
                  const why = blockedBecause(r, me);
                  if (why) return <span className="block max-w-[28ch] text-xs text-subtle">{why}</span>;
                  const banBusy = r.organizer && ban.busyId === r.organizer.id;
                  return (
                    <span className="fx-row justify-end">
                      {r.organizer && (
                        <button
                          type="button"
                          className="es-btn es-btn--secondary es-btn--sm"
                          disabled={busyId === r.id || banBusy}
                          onClick={() => ban.toggleBan(r.organizer)}
                        >
                          {banBusy ? 'Working…' : r.organizer.isBanned ? 'Lift ban' : 'Ban from selling'}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`es-btn es-btn--sm ${r.isBlocked ? 'es-btn--secondary' : 'es-btn--danger'}`}
                        disabled={busyId === r.id}
                        onClick={() => toggleBlock(r)}
                      >
                        {r.isBlocked ? 'Unblock' : 'Block'}
                      </button>
                    </span>
                  );
                },
              },
            ]}
          />
          <Pagination pagination={data.pagination} onPage={(n) => set('page', String(n))} />
        </>
      )}
    </div>
  );
}

/**
 * Why the controls are not offered for this row, in this screen's words.
 *
 * The RULE comes from `lib/roleLadder`, which mirrors the API's `mayActOn`;
 * only the sentences are local. It was written out here by hand, with its own
 * copy of the level map — and the API has changed this rule once already.
 */
const WHY = {
  [REFUSAL.SELF]: 'You cannot act on your own account — ask another administrator.',
  [REFUSAL.SUPERIOR]: 'A superior cannot be acted on from here.',
  [REFUSAL.EQUAL]: 'An equal cannot be acted on from here.',
};

function blockedBecause(row, me) {
  return WHY[actRefusal(me, row)] || null;
}

function RoleCell({ row, me, busy, onChange }) {
  if (blockedBecause(row, me)) return <span className="es-pill">{roleLabel(row.role)}</span>;
  return (
    <select
      value={row.role}
      disabled={busy}
      onChange={(e) => onChange(row, e.target.value)}
      aria-label={`Role for ${row.email}`}
      className="es-input es-input--sm"
    >
      {ROLES.map((r) => (
        // Rule 3, surfaced as an unselectable option rather than a refusal after the fact.
        // Nobody hands out a level above their own — the same comparison the
        // API makes, rather than a hardcoded pair of role names.
        <option key={r.value} value={r.value} disabled={!canAssign(me, r.value)}>
          {r.label}
        </option>
      ))}
    </select>
  );
}
