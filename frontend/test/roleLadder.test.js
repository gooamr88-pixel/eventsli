import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROLE_LEVEL, ROLES, STAFF_ROLES, REFUSAL, actRefusal, canAssign, roleLabel,
} from '../src/app/lib/roleLadder';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONSOLE MUST NOT OFFER WHAT THE API WILL REFUSE — nor hide what it allows.
 *
 * The rule lived in three places: the API, and two hand-written copies in the
 * admin console. They had already drifted (one defaulted an unknown role to 0,
 * the other to 1), and the API's own notes record that the rule has CHANGED
 * once — the third clause used to be "nobody acts on an equal", which made
 * every super admin untouchable.
 *
 * So these do two jobs. They pin the behaviour, and they read the API's source
 * to check the two ladders still agree — because the failure mode is silent:
 * a console that keeps offering a button the server started refusing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const BACKEND = path.join(process.cwd(), '..', 'backend', 'utils', 'roleLadder.js');
const USER_CONTROLLER = path.join(process.cwd(), '..', 'backend', 'controllers', 'admin', 'userController.js');

const at = (role, id = 'me') => ({ id, role });

describe('the ladder matches the API', () => {
  test('the level map is character for character the API\'s', () => {
    const src = fs.readFileSync(BACKEND, 'utf8');
    const line = src.match(/const ROLE_LEVEL = Object\.freeze\(\{([^}]*)\}\)/)?.[1];
    expect(line, 'could not find ROLE_LEVEL in the API').toBeTruthy();

    const theirs = Object.fromEntries(
      line.split(',').map((p) => p.split(':').map((s) => s.trim())).filter((p) => p[0])
        .map(([k, v]) => [k, Number(v)]),
    );
    expect(theirs).toEqual(ROLE_LEVEL);
  });

  test('the staff roles are the API\'s', () => {
    const src = fs.readFileSync(USER_CONTROLLER, 'utf8');
    const line = src.match(/const STAFF = new Set\(\[([^\]]*)\]\)/)?.[1];
    expect(line, 'could not find STAFF in the API').toBeTruthy();
    const theirs = line.split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
    expect(theirs).toEqual([...STAFF_ROLES]);
  });

  test('every assignable role is on the ladder', () => {
    for (const r of ROLES) expect(ROLE_LEVEL[r.value], r.value).toBeTypeOf('number');
  });
});

describe('who may be acted on', () => {
  test('nobody acts on themselves', () => {
    expect(actRefusal(at('super_admin', 'x'), at('super_admin', 'x'))).toBe(REFUSAL.SELF);
    expect(actRefusal(at('admin', 'x'), at('attendee', 'x'))).toBe(REFUSAL.SELF);
  });

  test('nobody acts on a superior', () => {
    expect(actRefusal(at('admin', 'a'), at('super_admin', 'b'))).toBe(REFUSAL.SUPERIOR);
    expect(actRefusal(at('organizer', 'a'), at('admin', 'b'))).toBe(REFUSAL.SUPERIOR);
  });

  test('an equal is refused — except to a super admin', () => {
    expect(actRefusal(at('admin', 'a'), at('admin', 'b'))).toBe(REFUSAL.EQUAL);
    // The clause that changed. Without it a compromised super admin could only
    // be removed with SQL, and the API's last-super-admin guard is unreachable.
    expect(actRefusal(at('super_admin', 'a'), at('super_admin', 'b'))).toBeNull();
  });

  test('an inferior is actionable', () => {
    expect(actRefusal(at('admin', 'a'), at('organizer', 'b'))).toBeNull();
    expect(actRefusal(at('super_admin', 'a'), at('admin', 'b'))).toBeNull();
  });

  test('an unknown role is treated as the lowest, which can only hide a control', () => {
    // Erring low is the safe direction: it may withhold something the API would
    // have allowed, never offer something it will refuse.
    expect(actRefusal(at('admin', 'a'), at('wizard', 'b'))).toBeNull();
    expect(actRefusal(at('wizard', 'a'), at('attendee', 'b'))).toBe(REFUSAL.EQUAL);
  });
});

describe('which roles may be granted', () => {
  /**
   * The rule that is easy to lose. At every level except admin-granting-admin,
   * "not above your own" and "staff is super-admin-only" give the same answer —
   * so an implementation with only the first looks correct until an admin opens
   * the dropdown and is offered a promotion the server will refuse.
   */
  test('an admin cannot grant a staff role, including their own level', () => {
    const admin = { id: 'a', role: 'admin', isSuperAdmin: false };
    expect(canAssign(admin, 'admin')).toBe(false);
    expect(canAssign(admin, 'super_admin')).toBe(false);
    expect(canAssign(admin, 'organizer')).toBe(true);
    expect(canAssign(admin, 'attendee')).toBe(true);
  });

  test('a super admin may grant anything on the ladder', () => {
    const sa = { id: 's', role: 'super_admin', isSuperAdmin: true };
    for (const r of ROLES) expect(canAssign(sa, r.value), r.value).toBe(true);
  });

  test('nobody below staff grants anything above themselves', () => {
    const organizer = { id: 'o', role: 'organizer' };
    expect(canAssign(organizer, 'admin')).toBe(false);
    expect(canAssign(organizer, 'organizer')).toBe(true);
  });

  test('it reads isSuperAdmin or the role, since the session carries both', () => {
    expect(canAssign({ id: 's', role: 'super_admin' }, 'admin')).toBe(true);
    expect(canAssign({ id: 's', isSuperAdmin: true, role: 'super_admin' }, 'admin')).toBe(true);
  });
});

test('roleLabel falls back to the raw value rather than rendering nothing', () => {
  expect(roleLabel('super_admin')).toBe('Super admin');
  expect(roleLabel('wizard')).toBe('wizard');
});
