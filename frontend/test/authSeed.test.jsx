import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(), post: vi.fn() }));

import { get } from '../src/app/utils/apiClient';
import { setAuthUser, resetAuthForTests, useAuth } from '../src/app/hooks/useAuth';
import AdminEntry from '../src/app/organizer/AdminEntry';

/**
 * Signing in seeds the user from the sign-in answer, which carries only the
 * identity — then fills in the access picture from /auth/me straight away.
 * Before that second ask, an admin who signed in saw no "Super admin access"
 * card until they reloaded the page (2026-11-03).
 */

const IDENTITY = { id: 'u1', email: 'owner@eventsli.test', fullName: 'Owner', role: 'super_admin', accountTypes: ['organizer'] };
const ME = { ...IDENTITY, isAdmin: true, isSuperAdmin: true, isOrganizer: true, organizerId: 'o1' };

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthForTests();
});

test('an admin who has just signed in sees the admin card without reloading', async () => {
  let answer;
  get.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
  render(<AdminEntry />);

  act(() => setAuthUser(IDENTITY));
  expect(get).toHaveBeenCalledWith('/auth/me', expect.objectContaining({ cache: 'no-store' }));
  expect(screen.queryByText('Super admin access')).not.toBeInTheDocument();

  await act(async () => { answer(ME); });
  expect(screen.getByText('Super admin access')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Admin dashboard/ })).toHaveAttribute('href', '/admin/overview');
});

test('a late "signed out" from before the sign-in cannot sign the user back out', async () => {
  const pending = [];
  get.mockImplementation(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }); }));

  function Who() {
    const { user } = useAuth();
    return <p>{user ? `signed in as ${user.email}` : 'signed out'}</p>;
  }
  render(<Who />);                         // the page's own first check: still in flight
  act(() => setAuthUser(IDENTITY));        // then the sign-in lands, and asks again

  await act(async () => { pending[1].resolve(ME); });
  await act(async () => { pending[0].reject(Object.assign(new Error('no session'), { status: 401 })); });
  expect(screen.getByText('signed in as owner@eventsli.test')).toBeInTheDocument();
});
