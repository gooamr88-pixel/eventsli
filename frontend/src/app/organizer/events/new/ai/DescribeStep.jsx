'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import NavIcon from '../../../../components/shell/NavIcon';
import { SelectField } from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import { COUNTRY_OPTIONS } from '../../../../lib/markets';
import { defaultTimeZone, zonesFor } from '../../../../lib/timezones';
import { browserZone } from '../../../../lib/eventTime';
import { AiStepper, QuotaDots, ActionBar, nextDraftTime } from './AiParts';
import { MIN_DESCRIPTION, MAX_DESCRIPTION } from './aiDraftModel';

const HINTS = [
  ['calendar', 'Date and times'],
  ['pin', 'Venue and city'],
  ['ticket', 'Ticket prices'],
  ['list', 'Running order'],
];

/**
 * STEP 1 — the organizer's own words.
 *
 * Three choices stay the organizer's and never the AI's: whether the event
 * sells tickets at all, the country (which sets the currency) and the time
 * zone (which decides what "8pm" means). Everything else comes out of the box.
 *
 * Generate stays off below 40 characters, with the reason under the box
 * rather than a disabled button that says nothing, and off when today's
 * drafts are used — with when the next one comes, and the way out.
 */
export default function DescribeStep({ request, setRequest, quota, error, onGenerate, onManual, onBackToDraft }) {
  const textId = useId();
  const hintId = useId();
  const [where, setWhere] = useState(false);
  const [tried, setTried] = useState(false);

  const length = request.description.trim().length;
  const tooShort = length < MIN_DESCRIPTION;
  const exhausted = quota && quota.remaining < 1;
  const zone = zonesFor(request.country).find(([z]) => z === request.timezone);
  const set = (k, v) => setRequest((r) => ({ ...r, [k]: v }));

  function submit(e) {
    e.preventDefault();
    setTried(true);
    if (!tooShort && !exhausted) onGenerate();
  }

  return (
    <form className="es-ai es-ai--describe" onSubmit={submit} noValidate>
      <AiStepper index={0} />
      <header className="es-ai-head">
        <h1 className="es-ai-title">Describe your event</h1>
        <p className="es-ai-lede">Write it the way you&rsquo;d tell a friend.</p>
      </header>

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
                label="Country" required value={request.country} options={COUNTRY_OPTIONS}
                onChange={(e) => setRequest((r) => ({ ...r, country: e.target.value, timezone: defaultTimeZone(e.target.value, browserZone()) }))}
              />
              <SelectField
                label="Time zone" required value={request.timezone} options={zonesFor(request.country)}
                onChange={(e) => set('timezone', e.target.value)}
              />
            </div>
          ) : (
            <div className="es-ai-where">
              <span><NavIcon name="pin" size={16} /> {COUNTRY_OPTIONS.find(([c]) => c === request.country)?.[1] || request.country} · {zone ? zone[1].split(' — ')[0] : request.timezone} time</span>
              <button type="button" className="es-ai-link" onClick={() => setWhere(true)} aria-label="Change country and time zone">
                Change
              </button>
            </div>
          )}

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
        </div>

        <aside className="es-ai-side" aria-label="Tips">
          <p className="es-ai-side__title">The draft gets better with</p>
          <ul className="es-ai-chips">
            {HINTS.map(([icon, label]) => <li key={label}><NavIcon name={icon} size={15} /> {label}</li>)}
          </ul>
          {/* D-019: the free Gemini tier may use what it is sent. Said here, at
              the moment of sending, not only in the privacy policy. */}
          <p className="es-ai-privacy">
            <NavIcon name="shield" size={15} />
            <span>
              To write the draft, your description is sent to Google Gemini, with Groq as a backup. Google may use it to
              improve its products. Email addresses and phone numbers are removed first.{' '}
              <Link href="/privacy" className="es-ai-link">Privacy</Link>
            </span>
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
