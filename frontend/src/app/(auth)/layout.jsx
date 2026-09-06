/**
 * A narrow, centred column for the four credential screens.
 *
 * A route group — `(auth)` in parentheses — so it shares a layout without
 * adding a segment to any URL. The pages are `/login`, not `/auth/login`, which
 * is what `proxy.ts` guards and what every "sign in" link in the app points at.
 */
export default function AuthLayout({ children }) {
  return (
    <main className="fx-section fx-section--sm">
      <div className="fx-container fx-container--xs">{children}</div>
    </main>
  );
}
