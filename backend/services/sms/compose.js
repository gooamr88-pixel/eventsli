const { analyze } = require('./segments');
const { canReceiveReplies } = require('./routing');

/**
 * The exact text a recipient receives.
 *
 * Marketing traffic always names the sender and always says how to stop. The
 * opt-out line depends on the SENDER, which is only known at dispatch: a phone
 * number can receive "STOP", an alphanumeric sender ID cannot, so for those
 * the line becomes a short unsubscribe link. Transactional text is left as
 * its template wrote it.
 *
 * Pure.
 */

function withBrand(body, brand) {
  const text = String(body || '').trim();
  return text.toLowerCase().startsWith(String(brand).toLowerCase()) ? text : `${brand}: ${text}`;
}

function compose({ baseBody, category, settings, sender = null, unsubscribeUrl = null }) {
  let text = String(baseBody || '').trim();
  if (category.traffic_class === 'marketing') {
    text = withBrand(text, settings.brand_name);
    if (category.append_opt_out) {
      const line = !sender || canReceiveReplies(sender) || !unsubscribeUrl
        ? settings.opt_out_text
        : `Opt out: ${unsubscribeUrl}`;
      text = `${text}\n${line}`;
    }
  }
  return { body: text, ...analyze(text) };
}

module.exports = { compose, withBrand };
