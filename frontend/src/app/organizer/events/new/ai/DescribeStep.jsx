'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import NavIcon from '../../../../components/shell/NavIcon';
import { SelectField } from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import { COUNTRY_NAMES } from '../../../../lib/markets';
import { useOpenCountries } from '../../../../hooks/useOpenCountries';
import { zoneLabel, zoneOptions } from '../../../../lib/timezones';
import { AiStepper, QuotaDots, ActionBar, nextDraftTime } from './AiParts';
import { MIN_DESCRIPTION, MAX_DESCRIPTION, MAX_NOTES } from './aiDraftModel';
import PosterDrop from './PosterDrop';

const HINTS = [
  ['calendar', 'Date and times'],
  ['pin', 'Venue and city'],
  ['ticket', 'Ticket prices'],
  ['list', 'Running order'],
];

const POSTER_HINTS = [
  ['image', 'The whole poster, not cropped'],
  ['eye', 'Sharp enough to read the small print'],
  ['ticket', 'Prices it leaves out go in the note'],
];

/**
 * STEP 1 — the organizer's own words, or their poster.
 *
 * TWO WAYS IN, ONE DRAFT. A poster (when `/ai/quota` says `poster: true`) or a
 * description; either produces the same draft, reviewed on the same screen
 * and saved the same way, for one of the same daily drafts. The poster is the
 * first choice when it is offered — most events already have one, and it is
 * the fastest honest way to a complete listing.
 *
 * Three choices stay the organizer's and never the AI's: whether the event
 * sells tickets at all, the country (which sets the currency) and the time
 * zone (which decides what "8pm" means). Everything else comes out of the box.
 *
 * Generate stays off below 40 characters, with the reason under the box
 * rather than a disabled button that says nothing, and off when today's
 * drafts are used — with when the next one comes, and the way out.
 */
export default function DescribeStep({
  request, setRequest, quota, error, onGenerate, onManual, onBackToDraft, poster = null, onPoster = () => {},
}) {
  const textId = useId();
  const hintId = useId();
  const notesId = useId();
  const [where, setWhere] = useState(false);
  const { options: countryOptions } = useOpenCountries();
  const [tried, setTried] = useState(false);

  const posterOffered = Boolean(quota?.poster);
  const fromPoster = posterOffered && request.mode === 'poster';
  const length = request.description.trim().length;
  const tooShort = length < MIN_DESCRIPTION;
  const notReady = fromPoster ? !poster : tooShort;
  const exhausted = quota && quota.remaining < 1;
  const set = (k, v) => setRequest((r) => ({ ...r, [k]: v }));

  function submit(e) {
    e.preventDefault();
    setTried(true);
    if (!notReady && !exhausted) onGenerate();
  }

  return (
    <form className="es-ai es-ai--describe" onSubmit={submit} noValidate>
      <AiStepper index={0} />
      <header className="es-ai-head">
        <h1 className="es-ai-title">{fromPoster ? 'Start from your poster' : 'Describe your event'}</h1>
        <p className="es-ai-lede">
          {fromPoster
            ? 'We read every word on it, fill in the details, and write the listing for you to check.'
            : <>Write it the way you&rsquo;d tell a friend.</>}
        </p>
      </header>

      {posterOffered && (
        <div className="es-ai-seg es-ai-seg--source" role="radiogroup" aria-label="Draft it from">
          {[['poster', 'From a poster', 'image'], ['text', 'Describe it', 'pencil']].map(([value, label, icon]) => (
            <label key={value} className={`es-ai-seg__opt${(fromPoster ? 'poster' : 'text') === value ? ' is-on' : ''}`}>
              <input
                type="radio" name="source" value={value}
                checked={(fromPoster ? 'poster' : 'text') === value}
                onChange={() => { setTried(false); set('mode', value); }}
              />
              <NavIcon name={icon} size={16} /> {label}
            </label>
          ))}
        </div>
      )}

      {exhausted && (
        <div className="es-ai-banner es-ai-banner--warn" role="status">
          <NavIcon name="clock" size={20} />
          <div>
            <p className="es-ai-banner__title">You&rsquo;ve used today&rsquo;s {quota.limit} AI drafts</p>
            <p>
              {nextDraftTime(quota.nextAvailableAt)
                ? <>The next one is available {nextDraftTime(quota.nextAvailableAt)}. </>
                : 'The next one is available tomorrow. '}
              Your text is kept here.{' '}
              <button type="button" className="es-ai-link" onClick={onManual}>Set it up yourself now</button>
            </p>
          </div>
        </div>
      )}

      <div className="es-ai-split">
        <div className="es-ai-panel">
          <div className="es-ai-seg" role="radiogroup" aria-label="What are you creating?">
            {[['ticketed', 'Ticketed', 'ticket'], ['display_only', 'Display only', 'eye']].map(([value, label, icon]) => (
              <label key={value} className={`es-ai-seg__opt${request.listingType === value ? ' is-on' : ''}`}>
                <input
                  type="radio" name="listingType" value={value}
                  checked={request.listingType === value}
                  onChange={() => set('listingType', value)}
                />
                <NavIcon name={icon} size={16} /> {label}
              </label>
            ))}
          </div>

          {where ? (
            <div className="fx-grid fx-grid--2">
              <SelectField
                label="Country" required value={request.country} options={countryOptions}
                onChange={(e) => set('country', e.target.value)}
              />
              <SelectField
                label="Time zone" required value={request.timezone} options={zoneOptions(request.country, request.timezone)}
                onChange={(e) => set('timezone', e.target.value)}
              />
            </div>
          ) : (
            <div className="es-ai-where">
              <span><NavIcon name="pin" size={16} /> {COUNTRY_NAMES[request.country] || request.country} · {zoneLabel(request.timezone)}</span>
              <button type="button" className="es-ai-link" onClick={() => setWhere(true)} aria-label="Change country and time zone">
                Change
              </button>
            </div>
          )}

          {fromPoster ? (
            <>
              <PosterDrop poster={poster} onPoster={onPoster} error={tried && !poster ? 'Add the poster first.' : null} />
              <div className="es-ai-ta es-ai-ta--short">
                <label htmlFor={notesId} className="es-ai-ta__label">
                  Anything the poster doesn&rsquo;t say? <span className="es-ai-ta__opt">Optional</span>
                </label>
                <textarea
                  id={notesId}
                  rows={3}
                  maxLength={MAX_NOTES}
                  value={request.notes || ''}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="e.g. Students $15 with ID. 200 tickets. Ends at 1am."
                />
                <div className="es-ai-ta__foot">
                  <span>Prices, ticket numbers or an end time help most.</span>
                  <span className="es-ai-count es-nums">{(request.notes || '').length}/{MAX_NOTES}</span>
                </div>
              </div>
            </>
          ) : (
          <div className={`es-ai-ta${tried && tooShort ? ' is-error' : ''}`}>
            <label htmlFor={textId} className="sr-only">About your event</label>
            <textarea
              id={textId}
              rows={10}
              maxLength={MAX_DESCRIPTION}
              value={request.description}
              onChange={(e) => set('description', e.target.value)}
              aria-describedby={hintId}
              aria-invalid={tried && tooShort ? 'true' : undefined}
              placeholder="e.g. Jazz night at The Rex, 194 Queen St W, Toronto, Friday 13 November, 8 to 11pm. Two sets from the Ava Lin Trio. General admission $30, students $20."
            />
            <div className="es-ai-ta__foot">
              <span id={hintId} className={tried && tooShort ? 'es-ai-err' : undefined}>
                {tried && tooShort
                  ? `Add a bit more — at least ${MIN_DESCRIPTION} characters.`
                  : 'Include what you know. Nothing is sent until you press Generate.'}
              </span>
              <span className="es-ai-count es-nums">{length}/{MAX_DESCRIPTION}</span>
            </div>
          </div>
          )}
        </div>

        <aside className="es-ai-side" aria-label="Tips">
          <p className="es-ai-side__title">{fromPoster ? 'For the best draft' : 'The draft gets better with'}</p>
          <ul className="es-ai-chips">
            {(fromPoster ? POSTER_HINTS : HINTS).map(([icon, label]) => <li key={label}><NavIcon name={icon} size={15} /> {label}</li>)}
          </ul>
          {/* D-019: the free Gemini tier may use what it is sent. Said here, at
              the moment of sending, not only in the privacy policy. */}
          <p className="es-ai-privacy">
            <NavIcon name="shield" size={15} />
            {fromPoster ? (
              <span>
                To write the draft, your poster and note are sent to Google Gemini, with Groq as a backup. Google may use
                them to improve its products. Photo location data is removed first, and phone numbers and emails on the
                poster are left out of the draft.{' '}
                <Link href="/privacy" className="es-ai-link">Privacy</Link>
              </span>
            ) : (
              <span>
                To write the draft, your description is sent to Google Gemini, with Groq as a backup. Google may use it to
                improve its products. Email addresses and phone numbers are removed first.{' '}
                <Link href="/privacy" className="es-ai-link">Privacy</Link>
              </span>
            )}
          </p>
        </aside>
      </div>

      <FormError error={error} />

      <ActionBar
        actions={(
          <>
            {/* Came here to regenerate: the draft they already have is one tap back. */}
            {onBackToDraft
              ? <button type="button" className="es-btn es-btn--ghost" onClick={onBackToDraft}>Back to your draft</button>
              : <Link href="/organizer/events/new" className="es-btn es-btn--ghost">Back</Link>}
            <button type="submit" className="es-btn es-btn--primary es-btn--lg" disabled={exhausted}>
              <NavIcon name="sparkle" size={18} /> Generate draft
            </button>
          </>
        )}
      >
        {exhausted ? <span className="text-sm text-muted">No AI drafts left today</span> : <QuotaDots quota={quota} />}
      </ActionBar>
    </form>
  );
}
