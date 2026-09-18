'use client';

import Link from 'next/link';
import { useAuth } from '../../hooks/useAuth';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HERO'S "START SELLING" BUTTON — which was a dead end for anybody already
 * signed in.
 *
 * The admin sets its label and its link, and the link defaults to `/register`.
 * `proxy.ts` bounces a signed-in visitor off every `/register*` path back to
 * `/` — correctly, because there is nothing to register — so pressing the
 * button from the homepage returned them to the homepage. Nothing errored,
 * nothing was logged, and it read as a button that does not work.
 *
 * It is the same fact the header's own button already knew and this one did
 * not: an organizer wants to CREATE something, a signed-in buyer wants the
 * page where they become an organizer, and only a stranger wants to register.
 *
 * WHY A CLIENT ISLAND IN A SERVER HERO. The session is not known on the
 * server, and this button is in the most-indexed markup on the site. So the
 * admin's own href is what renders — in the HTML, for a crawler and for the
 * first paint — and the destination is only swapped once `useAuth` has an
 * answer. While `loading` is true nothing changes, which is why a signed-out
 * visitor never sees it move.
 *
 * ONLY `/register*` IS REDIRECTED. An admin who points this button at
 * `/why-us` or an external page means it, and their link is left alone —
 * this repairs one specific dead end rather than taking the button over.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function HeroCta({ href, className, children }) {
  const { signedIn, loading, user } = useAuth();

  return (
    <Link href={resolveCta(href, { signedIn, loading, user })} className={className}>
      {children}
    </Link>
  );
}

/**
 * Where the button should actually go.
 *
 * Exported for its test: the rule is easy to state and easy to get subtly
 * wrong, and the failure is silent — a button that quietly returns somebody to
 * the page they pressed it on.
 */
export function resolveCta(href, { signedIn, loading, user }) {
  const to = href || '/register';

  // Not yet known, or nothing to fix: leave the admin's link exactly as it is.
  if (loading || !signedIn) return to;
  if (!(to === '/register' || to.startsWith('/register/'))) return to;

  // An organizer is here to start an event, not to sign up again.
  if (user?.isOrganizer) return '/organizer/events/new';

  // A signed-in buyer: `/organizer` is the page that asks them for the
  // organizer details they do not have yet. `/register/organizer` would be
  // bounced straight back by the proxy.
  return '/organizer';
}
