import { create } from 'zustand';

/**
 * A sign-up between "Create account" and the 6-digit code — in memory only.
 *
 * The password is kept just long enough to sign in once the email is
 * confirmed, so the person is not asked for it twice, and is dropped the
 * moment that happens (or the screen is left). It never touches the disk or a
 * route parameter: a route's params are logged by navigation in development
 * and restored from state after a crash.
 */
type State = {
  email: string | null;
  password: string | null;
  set: (email: string, password: string | null) => void;
  clear: () => void;
};

export const usePendingSignUp = create<State>((set) => ({
  email: null,
  password: null,
  set: (email, password) => set({ email, password }),
  clear: () => set({ email: null, password: null }),
}));
