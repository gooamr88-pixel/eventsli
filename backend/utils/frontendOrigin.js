/**
 * The frontend origin to put in a link we send or redirect to.
 *
 * Chosen from OUR allowlist (`FRONTEND_URL`, comma-separated), never echoed from
 * the request: `Origin` is attacker-controlled, and a link built from it is a
 * page of theirs wearing our domain in an email we sent. The request's origin is
 * used only when it is already on the list — so a staging frontend gets staging
 * links — and otherwise the first entry wins.
 *
 * Pure: takes the header and the setting, so it is testable without a request.
 */
function frontendOrigin(claimedOrigin, setting = process.env.FRONTEND_URL) {
  const allowed = String(setting || '')
    .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  const claimed = String(claimedOrigin || '').replace(/\/$/, '');
  return allowed.includes(claimed) ? claimed : allowed[0] || 'http://localhost:3000';
}

module.exports = { frontendOrigin };
