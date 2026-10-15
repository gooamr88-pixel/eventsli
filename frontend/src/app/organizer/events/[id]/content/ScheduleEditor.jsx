'use client';

import { useState } from 'react';
import { Panel } from '../../../../components/ui/Page';
import { Loading, Empty } from '../../../../components/Feedback';
import FormError from '../../../../components/forms/FormError';
import { useConfirm } from '../../../../components/ui/Confirm';
import { useToast } from '../../../../components/ui/Toast';
import { toIso, toLocalInput } from '../../../../lib/eventTime';
import { useContentSection, useSectionDraft } from './useContentSection';
import SaveBar from './SaveBar';
import RowControls from './RowControls';

/**
 * A pending row edit → the patch the API takes.
 *
 * Trimming and the empty-to-null rule live here, applied once at save time.
 * `''` and `null` are different answers to the column: one is an empty string
 * the page would render as a blank line, the other is "not set".
 */
function normaliseRow(patch, timezone) {
  const out = {};
  if ('title' in patch) out.title = String(patch.title || '').trim();
  if ('location' in patch) out.location = String(patch.location || '').trim() || null;
  if ('description' in patch) out.description = String(patch.description || '').trim() || null;
  if ('_local' in patch) {
    out.startsAt = patch._local ? localToInstant(patch._local, timezone) : null;
  }
  return out;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The running order — a lineup, a conference programme, a wedding timeline.
 *
 * TIMES ARE OPTIONAL, and that is the decision this editor turns on. An
 * organizer sketching a programme knows the ORDER long before they know the
 * clock: doors, support, headliner. A form that demands a timestamp per row
 * turns a two-minute draft into five guesses they then have to remember to
 * correct — so rows without a time keep the order the arrows give them, and the
 * ones with a time sort by it.
 *
 * THE TIME IS ENTERED IN THE EVENT'S ZONE, and stored as an instant. A festival
 * runs past midnight and organizers travel; "22:30" typed on a laptop set to
 * another country has to still mean 22:30 at the venue. The conversion happens
 * here, against `event.timezone`, rather than being left to whatever the
 * browser thinks local time is.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ScheduleEditor({ eventId, timezone }) {
  const { items, error, busy, add, edit, remove, move, setError } = useContentSection(eventId, 'schedule');
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState({ title: '', startsAt: '', location: '', description: '' });

  /**
   * The saved rows' pending edits. `rows`, not `draft` — `draft` above is the
   * blank form for ADDING one, which is a different thing with the same name
   * in English.
   *
   * `edit` is wrapped so normalisation happens ONCE, on save, rather than on
   * every keystroke: text is trimmed, an emptied optional field becomes `null`
   * (the column's own "not set", which `''` is not), and the wall-clock string
   * the datetime input works in becomes an instant in the EVENT's zone. Doing
   * the conversion per keystroke would try to parse "2026-09-2" on the way to
   * "2026-09-25".
   */
  const rowsDraft = useSectionDraft({
    items,
    edit: (id, patch) => edit(id, normaliseRow(patch, timezone)),
  });

  const rows = {
    ...rowsDraft,
    /** The datetime input's own value, from the draft or from the saved row. */
    local: (item) => (
      rowsDraft.valueOf({ id: item.id, _local: instantToLocal(item.startsAt, timezone) }, '_local')
    ),
    setLocal: (id, value) => rowsDraft.setField(id, '_local', value),
  };

  async function submit(e) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const { ok } = await add({
      title: draft.title.trim(),
      startsAt: draft.startsAt ? localToInstant(draft.startsAt, timezone) : null,
      location: draft.location.trim() || null,
      description: draft.description.trim() || null,
    });
    if (ok) {
      setDraft({ title: '', startsAt: '', location: '', description: '' });
      toast.success('Added to the schedule.');
    }
  }

  async function removeItem(item) {
    const ok = await confirm({
      title: `Remove "${item.title}"?`,
      tone: 'danger',
      body: <p>It comes off the schedule on your event page.</p>,
      confirmLabel: 'Remove',
    });
    if (ok) remove(item.id);
  }

  return (
    <Panel
      title="Schedule & lineup"
      description={`Times are in ${timezone || 'the event’s time zone'}. Leave a time empty if you only know the order.`}
    >
      <FormError error={error} />

      {items === null ? (
        <Loading variant="list" rows={2} label="Loading the schedule" />
      ) : items.length === 0 ? (
        <Empty
          title="No schedule yet"
          hint="Even three lines — doors, main act, close — answers the question people email you about."
        />
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {items.map((item, index) => (
            <li key={item.id} className="fx-stack fx-stack--sm rounded-(--es-radius-md) border border-border-base p-3">
              <div className="fx-row flex-wrap items-end gap-2">
                {/* CONTROLLED, AND SAVED ON THE BUTTON. These were
                    `defaultValue` + `onBlur`, so tabbing through the row to
                    read it wrote every field it passed, and nothing on screen
                    ever said whether a write had landed. `draft.valueOf` shows
                    the typed value over the saved one; `SaveBar` commits. */}
                <label className="fx-stack fx-stack--sm fx-min0 flex-1 gap-1">
                  <span className="text-xs text-subtle">What</span>
                  <input
                    className="es-input es-input--sm"
                    value={rows.valueOf(item, 'title')}
                    maxLength={160}
                    onChange={(e) => rows.setField(item.id, 'title', e.target.value)}
                  />
                </label>
                <label className="fx-stack fx-stack--sm gap-1">
                  <span className="text-xs text-subtle">When (optional)</span>
                  <input
                    className="es-input es-input--sm"
                    type="datetime-local"
                    /* The draft holds the WALL-CLOCK text the input works in;
                       it is converted to an instant on save, once, rather than
                       on every keystroke — half-typed dates do not convert. */
                    value={rows.local(item)}
                    onChange={(e) => rows.setLocal(item.id, e.target.value)}
                  />
                </label>
              </div>

              <label className="fx-stack fx-stack--sm gap-1">
                <span className="text-xs text-subtle">Where (optional)</span>
                <input
                  className="es-input es-input--sm"
                  value={rows.valueOf(item, 'location')}
                  maxLength={120}
                  placeholder="Main stage"
                  onChange={(e) => rows.setField(item.id, 'location', e.target.value)}
                />
              </label>

              <label className="fx-stack fx-stack--sm gap-1">
                <span className="text-xs text-subtle">Details (optional)</span>
                <textarea
                  className="es-input" rows={2} maxLength={2000}
                  value={rows.valueOf(item, 'description')}
                  onChange={(e) => rows.setField(item.id, 'description', e.target.value)}
                />
              </label>

              <RowControls
                index={index}
                total={items.length}
                busy={busy}
                label="item"
                onMove={(delta) => move(item.id, delta)}
                onRemove={() => removeItem(item)}
              />
            </li>
          ))}
        </ul>
      )}

      <SaveBar
        dirty={rows.dirty}
        status={rows.status}
        failure={rows.failure}
        onSave={rows.save}
        onDiscard={rows.discard}
        label="schedule changes"
      />

      <form onSubmit={submit} className="fx-stack fx-stack--sm border-t border-border-base pt-4">
        <div className="fx-grid" style={{ '--fx-col': '200px', '--fx-gap': '10px' }}>
          <label className="fx-stack fx-stack--sm gap-1">
            <span className="text-sm text-ink">What</span>
            <input
              className="es-input" required maxLength={160}
              placeholder="Doors open"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="fx-stack fx-stack--sm gap-1">
            <span className="text-sm text-ink">When (optional)</span>
            <input
              className="es-input" type="datetime-local"
              value={draft.startsAt}
              onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
            />
          </label>
          <label className="fx-stack fx-stack--sm gap-1">
            <span className="text-sm text-ink">Where (optional)</span>
            <input
              className="es-input" maxLength={120}
              placeholder="Main stage"
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
            />
          </label>
        </div>

        <button type="submit" disabled={busy || !draft.title.trim()} className="es-btn es-btn--secondary self-start">
          Add to schedule
        </button>
      </form>
    </Panel>
  );
}

/**
 * A `datetime-local` value, read as a wall-clock time AT THE VENUE, into an
 * instant — or null for an empty or unreadable one.
 *
 * `new Date("2026-06-01T22:30")` is parsed in the BROWSER's zone, so an
 * organizer in Cairo scheduling a Toronto event would store 22:30 Cairo time —
 * seven hours out, and wrong in a way that looks right on their own screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHARED PAIR IN `lib/eventTime`, NOT A PRIVATE COPY — AND THE COPY CRASHED.
 *
 * This file measured the zone offset by formatting an instant with
 * `toLocaleString('en-CA')` and parsing the text back with `new Date()`. V8
 * renders that locale as "2026-11-01, 12:30:00 p.m.", which does not parse: the
 * offset came out NaN, `toISOString()` threw a RangeError, and the whole Page &
 * branding screen fell to its error boundary for ANY event with even one
 * schedule row — in Chrome, Edge and every Android browser. The comment above
 * it said the format "parses back reliably".
 *
 * `toLocalInput` reads the parts with `formatToParts` and never parses text;
 * `toIso` is the two-pass conversion the event's own dates already use, which
 * also handles a time near a daylight-saving change. Both are tested.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function localToInstant(value, timezone) {
  if (!value) return null;
  const iso = toIso(value, timezone || undefined);
  // `toIso` hands back its input unchanged when it cannot convert it. Anything
  // that is not an ISO instant is "not set", never a string the API would
  // reject as a malformed date.
  return typeof iso === 'string' && iso.endsWith('Z') ? iso : null;
}

/** The inverse — an instant back into what the venue's clock reads, for the input. */
export function instantToLocal(iso, timezone) {
  return toLocalInput(iso, timezone || undefined);
}
