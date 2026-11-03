/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One organizer request → one validated event draft, from a description or
 * from a poster.
 *
 * The provider order, the fallback, the overload retry and the clock are
 * `providerLoop.runProviders`, shared with every other AI feature. What is
 * specific to a draft is here: which prompt, which providers can be asked
 * (only those that can see, for a poster), and how an answer is accepted —
 * `validateDraft` against the organizer's words, or against the poster's
 * transcript plus the organizer's note.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const { buildRequest, buildPosterRequest } = require('./eventDraftPrompt');
const { validateDraft, clean } = require('./eventDraftValidate');
const { redact } = require('./redact');
const { CALLERS } = require('./providers');
const { aiError } = require('./aiHttp');
const { runProviders } = require('./providerLoop');

/** No fallback starts after this much of a TEXT request has gone. */
const LAST_START_MS = 15_000;

/** Longer than any real poster; past this the "transcript" is not one. */
const MAX_POSTER_TEXT = 4000;
/** Fewer readable characters than this between poster and note is not an event. */
const MIN_EVIDENCE = 12;

/**
 * A poster answer → the text its facts are checked against.
 *
 * The transcript is bounded and then REDACTED exactly like a typed
 * description: an email or a phone number printed on a poster is still a
 * third party's, and it is not evidence for any field the draft has.
 *
 * Throws AI_NOT_AN_EVENT — which ends the attempt WITHOUT a fallback — when
 * the model says the image is not an event, or there is nothing to read. A
 * second provider asked the same question about a photo of a dog is a second
 * call spent on the same answer.
 */
function readPoster(json, notes) {
  if (!json || typeof json !== 'object') return null;   // validateDraft says why
  const posterText = redact(clean(json.posterText, MAX_POSTER_TEXT) || '').text;
  const evidence = [posterText, notes].filter(Boolean).join('\n\n');
  if (json.isEventPoster === false || evidence.replace(/\s+/g, '').length < MIN_EVIDENCE) {
    throw aiError('AI_NOT_AN_EVENT', 'The image does not show an event.');
  }
  return { posterText, evidence };
}

/**
 * One draft, from a description (`text`) or from a poster (`image`, with
 * `text` as the organizer's optional note).
 */
async function generateEventDraft({
  text, image = null, listingType, country, currency, timezone, categories, cfg, now = new Date(), callers = CALLERS,
}) {
  const poster = Boolean(image);
  const request = poster
    ? buildPosterRequest({ notes: text, listingType, country, currency, timezone, categories, now })
    : buildRequest({ text, listingType, country, currency, timezone, categories, now });
  const slugs = categories.map((c) => c.slug);

  let read = null;
  const { result, meta } = await runProviders({
    request,
    image,
    order: poster ? cfg.visionOrder : cfg.order,
    clock: poster ? cfg.visionTimeouts : { total: 20_000, ...cfg.timeouts, lastStart: LAST_START_MS },
    label: poster ? 'event draft (poster)' : 'event draft',
    inputChars: text.length,
    final: ['AI_NOT_AN_EVENT'],
    callers,
    accept: (answer) => {
      read = poster ? readPoster(answer.json, text) : null;
      const evidence = read ? read.evidence : text;
      const { draft } = validateDraft(answer.json, { text: evidence, listingType, timezone, categories: slugs, now });
      return draft;
    },
  });

  return {
    draft: result,
    posterText: read ? read.posterText : null,
    meta: { ...meta, input_chars: read ? read.evidence.length : text.length },
  };
}

module.exports = { generateEventDraft, readPoster, LAST_START_MS };
