'use client';

import { useState } from 'react';
import { post, patch } from '../../utils/apiClient';
import { describeError } from '../../utils/errors';
import { useAuth } from '../../hooks/useAuth';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/Confirm';
import { PageHeader } from '../../components/ui/Page';
import { Segmented, SearchBox, Pagination } from '../../components/ui/Filters';
import DataTable from '../../components/ui/DataTable';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * People, and the ladder that governs what can be done to them (BRD §19).
 *
 * FOUR RULES, all enforced by the API and all RENDERED HERE AS REASONS rather
 * than discovered as a 403:
 *
 *   1. Nobody acts on themselves. An admin who could edit their own role is not
 *      constrained by roles at all.
 *   2. Nobody acts on an equal or a superior — otherwise one compromised admin
 *      account disables every other admin and is the last one standing.
 *   3. Only a super admin grants a staff role, or `admin` is a role that mints
 *      more of itself.
 *   4. The last super admin cannot be demoted or blocked. Not "should not": the
 *      platform becomes unadministrable with no way back that avoids a SQL
 *      console.
 *
 * The UI disables what it can predict and explains why on the row. It does NOT
 * treat that as the enforcement — rule 4 depends on a count only the server
 * has, so the API's refusal is still the one that matters and it is shown in
 * full when it comes.
 *
 * Blocking and banning REQUIRE a reason (5–1000 characters, enforced by the
 * route). It goes into `admin_audit`; asking for it is also the confirm step.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const LEVEL = { attendee: 0, organizer: 1, admin: 2, super_admin: 3 };
const ROLES = [
  { value: 'attendee', label: 'Attendee' },
  { value: 'organizer', label: 'Organizer' },
  { value: 'admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super admin' },
];
const roleLabel = (r) => ROLES.find((x) => x.value === r)?.label || r;

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);

  const query = new URLSearchParams({ limit: '25', page: String(page) });
  if (search) query.set('q', search);
  if (role) query.set('role', role);
  const { data, error, loading, reload } = useApi(`/admin/users?${query}`, { raw: true });
  const rows = data?.data || [];

  async function act(row, { path, body, method = 'post', done }) {
    setBusyId(row.id);
    try {
      if (method === 'patch') await patch(path, body, { noRedirect: true });
      else await post(path, body, { noRedirect: true });
      toast.success(done);
      reload();
    } catch (err) {
      const { title, recovery } = describeError(err);
      toast.error(recovery, { title });
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

  async function toggleBan(row) {
    const org = row.organizer;
    if (org.isBanned) {
      const ok = await confirm({ title: `Let ${org.displayName} sell again?`, body: <p>Their events can be submitted and sold again.</p>, confirmLabel: 'Unban' });
      if (ok) act(row, { path: `/admin/organizers/${org.id}/unban`, done: `${org.displayName} can sell again.` });
      return;
    }
    const answer = await confirm({
      title: `Stop ${org.displayName} selling?`,
      body: <p>They keep their account and can still see what they owe. Published events stay live — suspend those separately.</p>,
      confirmLabel: 'Ban from selling',
      tone: 'danger',
      reason: { label: 'Why is this organizer being stopped?', minLength: 5 },
    });
    if (answer) act(row, { path: `/admin/organizers/${org.id}/ban`, body: { reason: answer.reason }, done: `${org.displayName} is banned from selling.` });
  }

  return (
    <div className="fx-stack">
      <PageHeader eyebrow="Console" title="Accounts" lede="Everyone with an account, their role, and whether they can sign in or sell." />

      <div className="fx-stack fx-stack--sm">
        <Segmented label="Role" value={role} onChange={(v) => { setRole(v); setPage(1); }} options={[{ value: '', label: 'Everyone' }, ...ROLES]} />
        <SearchBox label="Search accounts" placeholder="Name or email" value={search} onSearch={(v) => { setSearch(v); setPage(1); }} />
      </div>

      {error ? (
        <ErrorNotice error={error} />
      ) : loading && !data ? (
        <Loading variant="list" rows={5} label="Loading accounts" />
      ) : rows.length === 0 ? (
        <Empty title="Nobody matches." hint="Search by email or name. Partial matches count." />
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
                  return (
                    <span className="fx-row justify-end">
                      {r.organizer && (
                        <button type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={busyId === r.id} onClick={() => toggleBan(r)}>
                          {r.organizer.isBanned ? 'Unban' : 'Ban from selling'}
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
          <Pagination pagination={data.pagination} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/** Rules 1 and 2 — the two this page can predict. The reason replaces the controls. */
function blockedBecause(row, me) {
  if (me?.id === row.id) return 'You cannot act on your own account — ask another administrator.';
  if ((LEVEL[row.role] ?? 0) >= (LEVEL[me?.role] ?? 0)) {
    return `${row.role === me?.role ? 'An equal' : 'A superior'} cannot be acted on from here.`;
  }
  return null;
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
        <option key={r.value} value={r.value} disabled={!me?.isSuperAdmin && ['admin', 'super_admin'].includes(r.value)}>
          {r.label}
        </option>
      ))}
    </select>
  );
}
