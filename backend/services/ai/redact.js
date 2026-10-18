/**
 * Takes email addresses and phone numbers out of an organizer's description
 * BEFORE it is sent to a model provider (owner decision D-020).
 *
 * The organizer is describing an event, and the model needs none of these to
 * do that. What it would otherwise receive is often somebody else's: a
 * caterer's mobile, a co-host's address, "RSVP to sarah@…". The free Gemini
 * tier may use what it is sent to improve Google's products (D-019), which is
 * the strongest reason not to send a third party's contact details there.
 *
 * NARROW ON PURPOSE. A phone pattern loose enough to catch every format also
 * catches "1601 Lake Shore Blvd" and "$1,250", and a redaction that eats the
 * address or the price breaks the very facts the draft is built from. So a
 * phone number here needs ten digits in the North American shape, or a
 * leading `+` and at least eight.
 *
 * The validator checks evidence against the REDACTED text, which is what the
 * model actually saw. A model cannot quote a phone number it never received.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// (416) 555-0199 · 416-555-0199 · 416.555.0199 · +1 416 555 0199 · 4165550199
const NANP = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
// +44 20 7946 0958 and other international numbers that start with `+`.
const INTL = /\+\d[\d\s().-]{7,18}\d/g;

function redact(input) {
  let removed = 0;
  const count = (label) => () => { removed += 1; return label; };
  const text = String(input || '')
    .replace(EMAIL, count('[email removed]'))
    .replace(INTL, count('[phone removed]'))
    .replace(NANP, count('[phone removed]'));
  return { text, removed };
}

module.exports = { redact };
