'use client';

import NavIcon from '../../../../components/shell/NavIcon';
import { categoryLabel } from '../../../../lib/categories';
import { toIso, formatEventTime } from '../../../../lib/eventTime';
import { AiStepper, ActionBar } from './AiParts';
import { priceToCents, laterNeeds, sectionState, TIER_KINDS } from './aiDraftModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * STEP 2 — the draft, shown as the event page it will become.
 *
 * WHY THE PAGE AND NOT A FORM. The first mockups were the wizard's form fields
 * with a tag on every one, and the owner rejected them as paperwork. A buyer
 * reads an event as a page; the organizer checks it the same way, and each
 * block has one Edit that opens its editor (`EditSheet`).
 *
 * ONLY PROBLEMS ARE LOUD. A missing end time or an unpriced ticket is an amber
 * row with a button that fixes it; everything that is fine is just content.
 * Where a fact came from is shown in the editor, on demand, as the organizer's
 * own words — not as a badge on every line.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const money = (cents, currency) => new Intl.NumberFormat('en-CA', {
  style: 'currency', currency: currency || 'CAD', minimumFractionDigits: cents % 100 ? 2 : 0,
}).format(cents / 100);

function Block({ id, title, onEdit, children, eyebrow }) {
  return (
    <section
      className="es-ai-sec" id={`ai-${id}`}
      aria-labelledby={eyebrow ? undefined : `ai-${id}-h`} aria-label={eyebrow ? title : undefined}
    >
      <div className="es-ai-sec__row">
        {eyebrow || <h2 id={`ai-${id}-h`} className="es-ai-h3">{title}</h2>}
        {/* aria-label, not a visually hidden suffix: the accessible-name
            algorithm drops the space before a hidden span and announces
            "EditWhen and where" (caught by the AI creator's tests). */}
        <button type="button" className="es-ai-edit" onClick={() => onEdit(id)} aria-label={`Edit ${title}`}>
          <NavIcon name="pencil" size={15} /> Edit
        </button>
      </div>
      {children}
    </section>
  );
}

function Need({ title, detail, action, onClick }) {
  return (
    <div className="es-ai-need">
      <span className="es-ai-fact__icon" aria-hidden="true"><NavIcon name="alert" size={18} /></span>
      <div className="es-ai-fact__body">
        <p className="es-ai-fact__main">{title}</p>
        {detail && <p className="es-ai-fact__sub">{detail}</p>}
      </div>
      <button type="button" className="es-ai-fix" onClick={onClick}>{action}</button>
    </div>
  );
}

function Fact({ icon, main, sub }) {
  return (
    <div className="es-ai-fact">
      <span className="es-ai-fact__icon" aria-hidden="true"><NavIcon name={icon} size={18} /></span>
      <div className="es-ai-fact__body">
        <p className="es-ai-fact__main">{main}</p>
        {sub && <p className="es-ai-fact__sub">{sub}</p>}
      </div>
    </div>
  );
}

/** "Saturday, November 7, 2026" — the weekday is the first thing a buyer checks. */
function longDate(iso, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone }).format(new Date(iso));
  } catch {
    return formatEventTime(iso, timeZone, { time: false });
  }
}

function whenText(form) {
  const start = toIso(form.startsAt, form.timezone);
  const date = longDate(start, form.timezone);
  const from = formatEventTime(start, form.timezone, { date: false });
  const to = form.endsAt ? formatEventTime(toIso(form.endsAt, form.timezone), form.timezone, { date: false }) : null;
  return { date, time: to ? `${from} – ${to}` : `Starts ${from}` };
}

export default function DraftReview({ form, problems, onEdit, onContinue, onRegenerate, quota, categories }) {
  const sections = sectionState(form, problems);
  const has = (field) => problems.some((p) => p.field === field);
  const ticketed = form.listingType !== 'display_only';
  const n = problems.length;
  const later = laterNeeds(form);
  const label = categories?.find((c) => c.slug === form.category)?.label || categoryLabel(form.category);
  const when = form.startsAt ? whenText(form) : null;

  function fixFirst() {
    const first = problems[0];
    if (!first) return;
    document.getElementById(`ai-${first.section}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    onEdit(first.section);
  }

  const regen = (
    <div className="es-ai-regen">
      <p><NavIcon name="sparkle" size={15} /> Built from your description</p>
      <button type="button" className="es-ai-link" onClick={onRegenerate} disabled={quota && quota.remaining < 1}>
        <NavIcon name="undo" size={15} /> Change it and regenerate
      </button>
      <p className="es-ai-regen__note">
        {quota && quota.remaining > 0
          ? `Uses 1 of your ${quota.remaining} AI draft${quota.remaining === 1 ? '' : 's'} left today and replaces this one.`
          : 'No AI drafts left today. Edit this one instead.'}
      </p>
    </div>
  );

  return (
    <div className="es-ai es-ai--review">
      <AiStepper index={1} />
      <div className="es-ai-reviewgrid">
        <nav className="es-ai-rail" aria-label="Your draft">
          <p className="es-ai-rail__title">Your draft</p>
          <ol className="es-ai-rail__list">
            {sections.map((s) => (
              <li key={s.id} data-state={s.problems.length ? 'need' : 'ok'}>
                <a href={`#ai-${s.id}`} onClick={(e) => { e.preventDefault(); onEdit(s.id); }}>
                  <NavIcon name={s.problems.length ? 'alert' : 'check'} size={18} />
                  <span>{s.label}{s.problems.length > 0 && <small>{s.problems[0].message}</small>}</span>
                </a>
              </li>
            ))}
          </ol>
          {regen}
        </nav>

        <div className="es-ai-reviewmain">
          {n > 0 ? (
            <div className="es-ai-ready" role="status">
              <span className="es-ai-ready__icon" aria-hidden="true"><NavIcon name="sparkle" size={20} /></span>
              <div><p className="es-ai-ready__title">Your draft is ready</p><p className="es-ai-ready__sub">Fix {n === 1 ? 'one thing' : `${n} things`}, then save. Nothing is public yet.</p></div>
              <span className="es-ai-ready__count" aria-hidden="true">{n}</span>
            </div>
          ) : (
            <div className="es-ai-ready es-ai-ready--ok" role="status">
              <span className="es-ai-ready__icon" aria-hidden="true"><NavIcon name="check" size={20} /></span>
              <div><p className="es-ai-ready__title">Everything needed is filled in</p><p className="es-ai-ready__sub">Continue to choose how buyers pay, then save a private draft.</p></div>
            </div>
          )}

          <article className="es-ai-page" aria-label="Your event page">
            <div className="es-ai-cover"><span className="es-ai-cover__chip"><NavIcon name="image" size={16} /> Add a cover after saving</span></div>
            <div className="es-ai-pad">
              <Block id="basics" title="Title and category" onEdit={onEdit} eyebrow={<p className="es-ai-eyebrow">{label}</p>}>
                <h1 className="es-ai-h1">{form.title || 'Untitled event'}</h1>
                {has('title') && <Need title="Give it a title" action="Add" onClick={() => onEdit('basics')} />}
              </Block>

              <Block id="when" title="When and where" onEdit={onEdit}>
                {when && !has('startsAt') ? <Fact icon="calendar" main={when.date} sub={when.time} />
                  : <Need title="When does it start?" detail={form.startEvidence ? `You wrote “${form.startEvidence}” — add the time.` : 'Your description doesn’t say.'} action="Add" onClick={() => onEdit('when')} />}
                {has('endsAt') && <Need title="When does it end?" detail={problems.find((p) => p.field === 'endsAt').message === 'When does it end?' ? 'Your description doesn’t say.' : problems.find((p) => p.field === 'endsAt').message} action="Add" onClick={() => onEdit('when')} />}
                {form.venueName || form.venueAddress
                  ? <Fact icon="pin" main={form.venueName || 'Venue to be added'} sub={[form.venueAddress, form.city].filter(Boolean).join(', ')} />
                  : null}
                {later.length > 0 && (
                  <p className="es-ai-later"><NavIcon name="info" size={15} /> Needed before you submit for review: {later.join(', ')}.</p>
                )}
              </Block>

              <Block id="about" title="About" onEdit={onEdit}>
                {form.description
                  ? <p className="es-ai-body">{form.description}</p>
                  : <p className="es-ai-later">No description yet. Optional, but it is what people read.</p>}
                <p className="es-ai-aiwrote"><NavIcon name="sparkle" size={14} /> Written by AI from your description. Read it once before you save.</p>
                {form.highlights.length > 0 && (
                  <ul className="es-ai-hl" aria-label="Highlights">{form.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
                )}
              </Block>

              {ticketed && (
                <Block id="tickets" title="Tickets" onEdit={onEdit}>
                  <p className="es-ai-fact__sub">
                    {form.admissionType === 'general' ? 'General admission' : 'Reserved seating'}
                    {form.admissionType === 'reserved' && ` · ${{ seat_only: 'buyers choose seats', table_only: 'whole tables only', seat_and_table: 'buyers choose a seat or a whole table' }[form.purchaseMode]}`}
                  </p>
                  {form.tiers.length === 0 && <p className="es-ai-later">No ticket types yet. Add them here or on the event after saving.</p>}
                  <ul className="es-ai-tiers">
                    {form.tiers.map((t) => {
                      const cents = t.free ? 0 : priceToCents(t.price);
                      const needs = problems.find((p) => p.field.startsWith(`tier-${t.key}`));
                      return needs ? (
                        <li key={t.key} className="es-ai-tiers__need">
                          <Need title={t.name || 'New ticket type'} detail={cents === null && !t.priceEvidence ? 'No price in your description.' : needs.message} action={cents === null ? 'Add price' : 'Fix'} onClick={() => onEdit('tickets')} />
                        </li>
                      ) : (
                        <li key={t.key}>
                          <div>
                            <p className="es-ai-tiers__name">{t.name}</p>
                            <p className="es-ai-fact__sub">{t.description || TIER_KINDS.find(([k]) => k === t.kind)?.[1]}{t.quantity ? ` · ${t.quantity} available` : ''}</p>
                          </div>
                          <span className="es-ai-price es-nums">{cents === 0 ? 'Free' : money(cents, form.currency)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </Block>
              )}

              <Block id="schedule" title="Schedule" onEdit={onEdit}>
                {form.schedule.length === 0
                  ? <p className="es-ai-later">No running order. Optional.</p>
                  : (
                    <ol className="es-ai-time">
                      {form.schedule.map((s) => (
                        <li key={s.key}>
                          <span className="es-nums">{s.startsAt ? formatEventTime(toIso(s.startsAt, form.timezone), form.timezone, { date: false }).replace(/\s[A-Z]{2,5}$/, '') : '—'}</span>
                          <span>{s.title || 'Untitled'}{s.location && <small> · {s.location}</small>}</span>
                        </li>
                      ))}
                    </ol>
                  )}
              </Block>
            </div>
          </article>
          <div className="es-ai-mobileonly">{regen}</div>
        </div>
      </div>

      <ActionBar
        actions={n > 0
          ? <button type="button" className="es-btn es-btn--primary es-btn--lg" onClick={fixFirst}>Fix {n === 1 ? 'it' : 'them'}</button>
          : <button type="button" className="es-btn es-btn--primary es-btn--lg" onClick={onContinue}>Continue <NavIcon name="arrow" size={18} /></button>}
      >
        {n > 0
          ? <span className="es-ai-bar__need"><NavIcon name="alert" size={18} /> {n === 1 ? '1 thing needs you' : `${n} things need you`}</span>
          : <span className="es-ai-bar__ok"><NavIcon name="check" size={18} /> Ready</span>}
      </ActionBar>
    </div>
  );
}
