/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Turning Stripe's configuration refusals into instructions.
 *
 * Dependency-free, and in its own file for the same reason `eventRules.js` is:
 * this is pure logic that must be testable with no database, no network and no
 * credentials. Left inside `stripeService.js` it dragged in the Supabase client,
 * which throws at module load without a service key — so the only way to
 * exercise it would have been against a live environment.
 *
 * Second time that has bitten this project. The rule it produced: if a function
 * has no I/O, it does not live in a file that does.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Stripe's configuration errors arrive as a paragraph of documentation links
 * inside a 400. Passed through untouched they reach the organizer as "something
 * went wrong" and the logs as noise — while the actual fix is one switch in a
 * Dashboard nobody thought to open.
 *
 * Only CONFIGURATION problems are translated. A declined card is not a
 * misconfiguration and must not be reported as one, so anything unrecognised
 * is returned exactly as it came in.
 */
function translateConnectError(err) {
  const msg = String(err?.message || '');
  if (!msg) return err;

  // Checked FIRST, because it also says "Accounts v1" and would otherwise get
  // the v1-toggle instruction below, which does not fix it (TECH-AUDIT-LOG
  // T-073, seen in test mode 2026-11-06): "You tried to create an Accounts v1
  // connected account using the legacy `type` field with your platform as the
  // losses collector…". Eventsli uses DESTINATION charges on Express accounts,
  // which Stripe pairs with the platform carrying losses — Stripe-managed risk
  // needs direct charges. So the fix is the platform's own acknowledgement of
  // that responsibility in its Connect platform profile, not a code change.
  if (/losses[ _]collector/i.test(msg)) {
    return Object.assign(
      new Error(
        'Stripe Connect will not create organizer accounts until the platform profile is complete. '
        + 'Eventsli uses destination charges, so the platform is responsible for connected-account '
        + 'losses: confirm that at https://dashboard.stripe.com/settings/connect/platform-profile '
        + '(in the same mode — test or live — as these keys) and try again.',
      ),
      { code: 'STRIPE_NOT_CONFIGURED', operatorAction: true, cause: err },
    );
  }

  // Stripe steers new integrations to Accounts v2 and refuses accounts.create.
  // v2 is still a preview API, so the supported answer for now is the v1
  // compatibility toggle — and the operator needs the exact page.
  if (/Accounts v1|accounts_v1|v2\/core\/accounts/i.test(msg)) {
    return Object.assign(
      new Error(
        'Stripe Connect cannot create accounts on this platform yet. '
        + 'Enable "Accounts v1 support" at '
        + 'https://dashboard.stripe.com/settings/features/feat_accounts_v1_support '
        + 'and try again.',
      ),
      { code: 'STRIPE_NOT_CONFIGURED', operatorAction: true, cause: err },
    );
  }

  if (/Connect/i.test(msg) && /not.*(enabled|activated)/i.test(msg)) {
    return Object.assign(
      new Error(
        'Stripe Connect is not switched on for this platform account. '
        + 'Enable it at https://dashboard.stripe.com/connect/overview.',
      ),
      { code: 'STRIPE_NOT_CONFIGURED', operatorAction: true, cause: err },
    );
  }

  return err;
}

module.exports = { translateConnectError };
