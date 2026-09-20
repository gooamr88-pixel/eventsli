import { defaultLanding, hasWorkspace, WORKSPACE } from './workspaces';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE MASTHEAD OFFERS, as data rather than as JSX.
 *
 * Split out of `SiteHeader.jsx`, which had grown past the 500-line cap
 * `scripts/fileSizeCheck.js` warns at — but the line count is the reason it
 * happened, not the reason it is right.
 *
 * These two functions are the only part of that file with rules in them. The
 * rest is a sticky bar, a burger and a panel. Who sees "Saved events", whether
 * the button says Dashboard or Create event, which of two facts about an
 * organizer decides that they can reach the create form — those are decisions
 * with arguments behind them, and until now the only way to check one was to
 * mount a client component that calls `useAuth` and reads the scroll position.
 * So there was no test for any of it.
 *
 * As a plain module they are pure functions of their arguments, and
 * `test/siteNav.test.js` states the rules back. `lib/` because they belong
 * beside `siteRoutes.js` — which declares the same site's public surface — and
 * because `workspaces.js`, the shared answer about where an account lands, is
 * already here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The link set, derived once.
 *
 * "Events" is the only link that does not depend on who is asking, so it is the
 * only one outside the conditional.
 *
 * @param {object} options
 * @param {boolean} options.signedIn
 * @param {boolean} options.loading    the session is still in flight
 * @param {object}  [options.user]
 * @param {string}  [options.pathname] where to come back to after signing in
 * @param {number}  [options.savedCount] events saved in THIS browser, for the
 *                                       signed-out reader's count
 */
export function navLinks({ signedIn, loading, user, pathname, savedCount = 0 }) {
  /**
   * THE BROWSE LINKS EVERY VISITOR GETS, signed in or not.
   *
   * There was one — "Events" — and the bar had nothing in it. The design this
   * storefront was built to carries six, and the ones here are those that
   * point at pages this product actually has. There is deliberately no
   * "Pricing" or "Sponsors" entry: neither page exists, and a nav link to a
   * 404 is worse than a shorter nav.
   */
  const browse = [
    { href: '/events', label: 'Events' },
    { href: '/how-it-works', label: 'How it works' },
    { href: '/why-us', label: 'For organizers' },
  ];
  // While the answer is in flight, only what everybody gets. Guessing
  // "signed out" and correcting a moment later is a flicker that every
  // signed-in person sees on every page.
  if (loading) return browse;

  if (signedIn) {
    /**
     * THE ORGANIZER LINK FOLLOWS THE WORKSPACE, NOT THE PERMISSION.
     *
     * This read `user.isOrganizer` — true only once an organizer PROFILE exists —
     * so somebody who signed up to sell and has not finished setting up was shown
     * no route to the dashboard at all, while the API's landing rule (which reads
     * the account TYPE) sent them there on every sign-in. The masthead disagreed
     * with the login redirect about the same account.
     *
     * `hasWorkspace` reads both facts, and `lib/workspaces.js` argues why either
     * alone strands somebody.
     */
    const organizing = hasWorkspace(user, WORKSPACE.ORGANIZER);

    return [
      ...browse,
      /**
       * `/account/tickets`, NOT `/account`.
       *
       * The button on the right of this bar goes to whichever dashboard this
       * account belongs on, and for a buyer that IS `/account` — so a link here
       * pointing at the same path would be two controls, differently labelled,
       * landing on one page. That is the duplicate-label problem this pass exists
       * to remove, and it would be self-inflicted.
       *
       * "My tickets" naming the tickets screen is also simply the honest reading
       * of the label. The dashboard is reached by the thing labelled Dashboard.
       */
      { href: '/account/tickets', label: 'My tickets' },
      /**
       * NO "Saved events" HERE, AND THAT IS THE DECISION, not an omission.
       *
       * This account has a sidebar, and `accountNavGroups` already lists the
       * saved list in its "Browse" group. A second entry in the masthead would
       * be the same label pointing at the same page from two places. The
       * signed-out branch below carries it because that reader has no sidebar
       * to carry it for them.
       */
      /**
       * THE PLAIN "Organizer" LINK IS GONE, and it is gone because it could not
       * ever have been reachable.
       *
       * `navCta` sends anybody with the organizer workspace to `/organizer`, and
       * `defaultWorkspace` prefers organizer over admin — so for every account
       * that would have been offered this link, the button two positions to the
       * right already went to the same page. It was a second, quieter control for
       * one destination, styled exactly like "Events", which is the shape of
       * duplicate navigation this pass exists to remove.
       */
      /**
       * "CREATE EVENT" IS A MENU ITEM AND NOT THE BUTTON, which is the earlier
       * fix and still right: before it, the button was the only route to the
       * create form from the storefront, and changing the button to "Dashboard"
       * left an organizer on the homepage with no way to start an event.
       *
       * ON `isOrganizer` — THE PERMISSION — DELIBERATELY, and this is the one
       * place in this file where that is the correct fact to read.
       * `/organizer/events/new` needs an organization to create the event under,
       * so offering the form to somebody who has not created one is a click into
       * a refusal. The WORKSPACE is what gets them to the setup screen; the
       * PERMISSION is what says the setup is finished. `organizing` is in the
       * condition as well so the two facts are read together and the intent is
       * legible: has the workspace, and has finished setting it up.
       */
      ...(organizing && user?.isOrganizer
        ? [{ href: '/organizer/events/new', label: 'Create event' }]
        : []),
    ];
  }

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * SIGNED OUT — AND THIS IS THE ONLY BRANCH THAT CARRIES "Saved events".
   *
   * The heart has been on every card and every event page for as long as both
   * have existed, and a visitor with no account is precisely the reader it was
   * built for: `useSavedEvents` keeps the list in localStorage exactly so that
   * saving never hits a sign-up wall. But the list had no entrance. Somebody
   * tapped a heart, watched it fill, and was given no route anywhere in the
   * chrome to the page that reads it back — the feature collected state that
   * only its own URL could show you.
   *
   * It is HERE and not in the signed-in branch because a signed-in buyer
   * already has this destination in their sidebar — `accountNavGroups` lists it
   * under "Browse", next to Discover. Putting it in both places would be two
   * controls with one label pointing at one page, which is the duplicate
   * navigation the rest of this module spends its comments removing. Signed out
   * there is no sidebar, so the masthead is the only place it can live.
   *
   * THE COUNT IS THE RECEIPT. Without it the link is a destination; with it, it
   * is confirmation that the heart on the last page did something and that the
   * list is not empty. It is omitted at zero rather than rendered as "(0)",
   * which is a badge announcing that nothing happened.
   *
   * Above "Find my tickets" deliberately: both are personal lists, and this one
   * belongs to the browsing someone is doing now, while that one is for an
   * order already placed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  return [
    ...browse,
    {
      href: '/events/saved',
      label: savedCount > 0 ? `Saved events (${savedCount})` : 'Saved events',
    },
    { href: '/tickets/find', label: 'Find my tickets' },
    { href: `/login?next=${encodeURIComponent(pathname || '/')}`, label: 'Sign in' },
  ];
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE BUTTON IN THE BAR — and it says a different thing to each visitor.
 *
 * The homepage has said since it was written that this site has two readers —
 * somebody looking for a ticket, and somebody deciding whether to sell here —
 * but the second reader could only find that out by scrolling to the fifth
 * band. This puts their next step in the masthead on every page.
 *
 * The earlier fix here still stands: it used to read "Create event" for
 * everybody, which is only the right words for one of the readers. An organizer
 * arriving at the storefront wants their DASHBOARD, and the bar had no button for
 * that — it was a plain "Organizer" link styled exactly like "Events".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED: A SIGNED-IN BUYER IS NO LONGER TOLD TO CREATE AN EVENT.
 *
 * The rule was `if (signedIn) return { href: '/organizer', label: 'Create
 * event' }` — the fall-through for anybody without an organizer profile. The
 * comment that defended it argued that a buyer "has no dashboard, so labelling
 * the button Dashboard would be a promise the next screen breaks", and given the
 * product at the time that was a fair reading of a bad situation.
 *
 * It was still the single loudest thing in the masthead telling somebody who came
 * to buy a ticket that this site is for selling them — and it pointed at
 * `/organizer`, a form asking for an organization name and the country that
 * decides their Stripe entity. That is the most prominent control on every page
 * of the site aimed at the one thing that reader did not come to do.
 *
 * The premise is gone: a buyer HAS a dashboard now, so the honest button is the
 * one that goes to it. Somebody who wants to sell is not stranded — "For
 * organizers" is in the nav on every page, the hero's own CTA still routes them
 * to `/organizer` (`HeroCta` handles that and is unchanged), and the switcher
 * appears the moment they have the workspace.
 *
 * WORKSPACES, NOT PERMISSIONS, and `defaultLanding` is the shared rule — so this
 * button, `/login`'s fallback and the switcher's precedence are one answer rather
 * than three. Organizer before admin is that rule's, for the reason this function
 * worked out first: somebody who is both is far more often coming back to their
 * own events than to the console.
 *
 * A STRANGER STILL GETS "Create event" → `/register/organizer`. They have no
 * account either way, and this is the storefront's pitch to the reader who is
 * deciding whether to sell here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function navCta({ signedIn, loading, user }) {
  // Nothing while the session is unknown: guessing and correcting makes the
  // button flip words on every page load for everyone who is signed in.
  if (loading) return null;
  if (signedIn) return { href: defaultLanding(user), label: 'Dashboard' };
  return { href: '/register/organizer', label: 'Create event' };
}
