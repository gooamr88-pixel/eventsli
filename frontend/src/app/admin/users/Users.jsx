'use client';

import { useEffect, useState } from 'react';
import { get, post, patch } from '../../utils/apiClient';
import { useAuth } from '../../hooks/useAuth';
import FormError from '../../components/forms/FormError';
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
 * treat that as the enforcement — rule 4 in particular depends on a count only
 * the server has, so the API's refusal is still the one that matters and it is
 * rendered in full when it comes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const LEVEL = { attendee: 0, organizer: 1, admin: 2, super_admin: 3 };
const ROLES = [['attendee', 'Attendee'], ['organizer', 'Organizer'], ['admin', 'Admin'], ['super_admin', 'Super admin']];

export default function Users() {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const query = new URLSearchParams({ limit: '50' });
      if (search) query.set('q', search);
      if (role) query.set('role', role);
      try {
        const data = await get(`/admin/users?${query}`, { cache: 'no-store' });
        if (!cancelled) { setRows(Array.isArray(data) ? data : []); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [search, role, reload]);

  return (
    <div className="fx-stack">
      <h2 className="text-xl">People</h2>

      <form onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }} className="fx-row">
        <div className="fx-row fx-row--scroll" role="group" aria-label="Role">
          {[['', 'Everyone'], ...ROLES].map(([v, l]) => (
            <button
              key={v || 'all'}
              type="button"
              onClick={() => setRole(v)}
              aria-pressed={role === v}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors ${
                role === v ? 'border-accent bg-accent text-on-accent' : 'border-border-strong text-muted hover:text-ink'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or email"
          aria-label="Search people"
          className="fx-min0 flex-1 es-input"
        />
        <button type="submit" className="rounded-[--es-radius-md] border border-border-strong px-3 py-2 text-sm text-ink">
          Search
        </button>
      </form>

      {error ? (
        <ErrorNotice error={error} />
      ) : !rows ? (
        <Loading variant="list" />
      ) : rows.length === 0 ? (
        <Empty
          title="Nobody matches."
          hint="Search by email or name. Partial matches count."
        />
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {rows.map((row) => (
            <UserRow key={row.id} row={row} me={me} onChanged={() => setReload((n) => n + 1)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function UserRow({ row, me, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  // `{ kind: 'block' | 'ban', path }` while a reason is being typed.
  const [confirming, setConfirming] = useState(null);
  const [reason, setReason] = useState('');

  // The two rules that can be predicted from what this page already knows. The
  // other two need server state, so their refusals arrive as messages.
  const isSelf = me?.id === row.id;
  const outranked = (LEVEL[row.role] ?? 0) >= (LEVEL[me?.role] ?? 0) && !isSelf;
  const canGrantStaff = me?.isSuperAdmin;

  const blockedBecause = isSelf
    ? 'You cannot act on your own account — ask another administrator.'
    : outranked
      ? `${row.role === me?.role ? 'An equal' : 'A superior'} cannot be acted on from here.`
      : null;

  async function act(path, body, method = 'post') {
    setBusy(path);
    setError(null);
    try {
      if (method === 'patch') await patch(path, body, { noRedirect: true });
      else await post(path, body, { noRedirect: true });
      setConfirming(null);
      setReason('');
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Blocking and banning REQUIRE a reason — 5 to 1000 characters, enforced by
   * the route. That is not a formality: the reason goes into `admin_audit`, and
   * "an admin did it" is not an answer months later when the person telephones.
   *
   * The first version of this page sent no body at all and every block failed
   * with a validation error. Asking for the reason is also the confirm step,
   * which these two actions need anyway.
   */
  const startReason = (kind, path) => { setConfirming({ kind, path }); setReason(''); setError(null); };

  return (
    <li className="fx-stack fx-stack--sm es-card p-4">
      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          <p className="fx-truncate text-ink">
            {row.fullName || 'Unnamed'}
            {isSelf && <span className="text-accent"> · you</span>}
          </p>
          <p className="fx-truncate text-sm text-muted">{row.email}</p>
          <p className="text-xs text-subtle">
            {row.role}
            {row.isBlocked && <span className="text-danger"> · blocked</span>}
            {row.organizer?.isBanned && <span className="text-danger"> · organizer banned</span>}
          </p>
        </div>

        <div className="fx-row">
          {blockedBecause ? (
            // The reason, in place of the controls. A row of disabled buttons
            // with no explanation is the thing this replaces.
            <p className="max-w-[26ch] text-right text-xs text-subtle">{blockedBecause}</p>
          ) : (
            <>
              <select
                value={row.role}
                disabled={busy !== null}
                onChange={(e) => act(`/admin/users/${row.id}/role`, { role: e.target.value }, 'patch')}
                aria-label={`Role for ${row.email}`}
                className="es-input es-input--sm"
              >
                {ROLES.map(([v, l]) => (
                  <option
                    key={v}
                    value={v}
                    // Rule 3, surfaced as an unselectable option rather than a
                    // refusal after the fact.
                    disabled={!canGrantStaff && ['admin', 'super_admin'].includes(v)}
                  >
                    {l}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={busy !== null}
                onClick={() => (row.isBlocked
                  // Unblocking takes an OPTIONAL reason, so it needs no step.
                  ? act(`/admin/users/${row.id}/unblock`)
                  : startReason('block', `/admin/users/${row.id}/block`))}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-sm transition-colors disabled:opacity-40 ${
                  row.isBlocked
                    ? 'bg-danger/15 text-danger hover:bg-success/15 hover:text-success'
                    : 'bg-bg-sunken text-muted hover:bg-danger/15 hover:text-danger'
                }`}
              >
                {busy ? '…' : row.isBlocked ? 'Blocked' : 'Block'}
              </button>
            </>
          )}
        </div>
      </div>

      {row.organizer && !blockedBecause && (
        <div className="fx-row fx-row--between border-t border-border-base pt-2">
          <p className="fx-min0 text-xs text-subtle">
            Organizer: {row.organizer.displayName}
            {' — '}
            {/* The distinction the API insists on, said out loud. */}
            banning stops them selling; it does not stop them signing in or seeing
            what they owe.
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => (row.organizer.isBanned
              ? act(`/admin/organizers/${row.organizer.id}/unban`)
              : startReason('ban', `/admin/organizers/${row.organizer.id}/ban`))}
            className="whitespace-nowrap text-sm text-muted hover:text-danger disabled:opacity-40"
          >
            {row.organizer.isBanned ? 'Unban' : 'Ban from selling'}
          </button>
        </div>
      )}

      {confirming && (
        <form
          onSubmit={(e) => { e.preventDefault(); act(confirming.path, { reason: reason.trim() }); }}
          className="fx-stack fx-stack--sm rounded-[--es-radius-md] bg-bg-sunken p-3"
        >
          <label htmlFor={`why-${row.id}`} className="text-sm text-ink">
            {confirming.kind === 'block'
              ? `Why is ${row.email} being blocked?`
              : `Why is ${row.organizer?.displayName} being stopped from selling?`}
          </label>
          <p className="text-xs text-subtle">
            {confirming.kind === 'block'
              ? 'Blocking ends every one of their sessions immediately.'
              : 'They keep their account and can still see what they owe. Published events stay live — suspend those separately.'}
          </p>
          <textarea
            id={`why-${row.id}`}
            rows={2}
            required
            minLength={5}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="es-input"
          />
          <p className="text-xs text-subtle">Kept in the audit log.</p>
          <div className="fx-row fx-row--between">
            <button
              type="button"
              onClick={() => { setConfirming(null); setError(null); }}
              className="text-sm text-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy !== null || reason.trim().length < 5}
              className="rounded-[--es-radius-md] bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? 'Working…' : confirming.kind === 'block' ? 'Block the account' : 'Ban from selling'}
            </button>
          </div>
        </form>
      )}

      <FormError error={error} />
    </li>
  );
}
