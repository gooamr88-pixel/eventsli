'use client';

import { useRef, useState } from 'react';
import { post } from '../../../../utils/apiClient';
import { messageFor } from '../../../../utils/errors';
import NavIcon from '../../../../components/shell/NavIcon';
import TierDetailIcon, { DETAIL_ICONS } from '../../../../components/tickets/TierDetailIcon';
import { downscale } from '../map/studio/uploadStudioImage';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The organizer's half of a ticket type's details card (owner request
 * 2026-11-10): the photo, a line under the name, what is included, the notes a
 * buyer should read before paying, what the price is "per", and whether the
 * card opens by itself before the first ticket of this type is chosen.
 *
 * A controlled editor: `value` is the card, `onChange` gets the next one, and
 * the ticket type's own Save sends it. Nothing is written from here except the
 * photo's bytes, which go straight to storage and come back as a path; the
 * server keeps only a path its upload step could have produced, and caps every
 * list and string (backend/services/ticketDetails.js) — the limits below are
 * the same numbers, so the editor stops where the server would.
 *
 * Suggestions are one tap to add and are ordinary rows afterwards: they save
 * typing the common lines ("Final sale", "Dinner included") without being a
 * template the organizer has to fight.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MAX_INCLUDED = 8;
const MAX_NOTES = 4;

const SUGGESTED_INCLUDED = [
  { icon: 'dinner', title: 'Dinner included', text: 'A curated multi-course menu' },
  { icon: 'drink', title: 'Hot & cold beverages', text: 'A selection of premium drinks' },
  { icon: 'table', title: 'Reserved table', text: 'Your own table for the evening' },
  { icon: 'seat', title: 'Premium seating', text: 'Among the best views in the room' },
  { icon: 'door', title: 'Fast-track entry', text: 'Skip the main queue' },
  { icon: 'star', title: 'Meet & greet', text: 'Meet the performers after the show' },
  { icon: 'gift', title: 'Welcome gift', text: '' },
  { icon: 'parking', title: 'Parking included', text: '' },
];

const SUGGESTED_NOTES = [
  { icon: 'tag', text: 'All tickets are final sale and non-refundable.' },
  { icon: 'shield', text: 'Limited tickets available — add yours to the cart before they sell out.' },
  { icon: 'seat', text: 'Seating is first-come, first-served.' },
  { icon: 'info', text: 'Valid photo ID is required at the door.' },
  { icon: 'users', text: 'Ages 19+ only.' },
];

const UNITS = [
  ['ticket', 'Per ticket'],
  ['person', 'Per person'],
  ['table', 'Per table'],
  ['group', 'Per group'],
];

export default function TierDetailsEditor({ eventId, value, onChange, onPreview }) {
  const d = value || {};
  const included = d.included || [];
  const notes = d.notes || [];
  const set = (patch) => onChange({ ...d, ...patch });

  return (
    <fieldset className="fx-stack fx-stack--sm gap-3 border-t border-border-base pt-4">
      <legend className="es-label mb-1.5"><span>Details buyers see before buying</span></legend>
      <div className="fx-row fx-row--between flex-wrap gap-2">
        <p className="text-sm text-muted fx-min0 flex-[1_1_18rem]">
          A card with a photo, what is included and anything a buyer should know. It opens from
          {' '}“What’s included” beside this ticket type, on the seat map and the ticket list.
        </p>
        {onPreview && (
          <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={onPreview}>
            <NavIcon name="eye" size={16} />Preview card
          </button>
        )}
      </div>

      <PhotoField eventId={eventId} image={d.image} onChange={(image) => set({ image })} />

      <label className="fx-stack fx-stack--sm gap-1.5">
        <span className="es-label"><span>Line under the name</span></span>
        <input
          className="es-input" maxLength={140}
          placeholder="e.g. A premium, all-inclusive dining experience"
          value={d.tagline || ''}
          onChange={(e) => set({ tagline: e.target.value })}
        />
      </label>

      <RowList
        title="What’s included"
        rows={included}
        max={MAX_INCLUDED}
        suggestions={SUGGESTED_INCLUDED.filter((s) => !included.some((r) => r.title === s.title))}
        suggestionLabel={(s) => s.title}
        blank={{ icon: 'check', title: '', text: '' }}
        onChange={(rows) => set({ included: rows })}
        renderFields={(row, update) => (
          <div className="es-tdxed__fields es-tdxed__fields--2">
            <input
              className="es-input" maxLength={80} placeholder="Title, e.g. A luxurious dinner"
              aria-label="Title" value={row.title} onChange={(e) => update({ title: e.target.value })}
            />
            <input
              className="es-input" maxLength={160} placeholder="Detail (optional)"
              aria-label="Detail" value={row.text || ''} onChange={(e) => update({ text: e.target.value })}
            />
          </div>
        )}
      />

      <RowList
        title="Good to know"
        rows={notes}
        max={MAX_NOTES}
        suggestions={SUGGESTED_NOTES.filter((s) => !notes.some((r) => r.text === s.text))}
        suggestionLabel={(s) => s.text}
        blank={{ icon: 'info', text: '' }}
        onChange={(rows) => set({ notes: rows })}
        renderFields={(row, update) => (
          <div className="es-tdxed__fields">
            <input
              className="es-input" maxLength={200} placeholder="e.g. All tickets are final sale and non-refundable."
              aria-label="Note" value={row.text} onChange={(e) => update({ text: e.target.value })}
            />
          </div>
        )}
      />

      <div className="fx-grid fx-grid--2 items-end">
        <label className="fx-stack fx-stack--sm gap-1.5">
          <span className="es-label"><span>The price is</span></span>
          <select className="es-input" value={d.priceUnit || 'ticket'} onChange={(e) => set({ priceUnit: e.target.value })}>
            {UNITS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
        <label className="es-check">
          <input
            type="checkbox" className="es-check__box"
            checked={Boolean(d.showBeforeBuying)}
            onChange={(e) => set({ showBeforeBuying: e.target.checked })}
          />
          <span className="text-sm">
            <span className="block text-ink">Show this card before buying</span>
            <span className="block text-muted">It opens by itself the first time a buyer picks this ticket type.</span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}

function RowList({ title, rows, max, suggestions, suggestionLabel, blank, onChange, renderFields }) {
  const update = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i, by) => {
    const next = [...rows];
    const [row] = next.splice(i, 1);
    next.splice(i + by, 0, row);
    onChange(next);
  };
  const full = rows.length >= max;

  return (
    <div className="fx-stack fx-stack--sm gap-2">
      <div className="fx-row fx-row--between">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="text-xs text-subtle es-nums">{rows.length} of {max}</span>
      </div>

      {rows.map((row, i) => (
        // Index keys: rows have no id, and they are reordered by the buttons
        // below, which re-render every row anyway.
        <div key={i} className="es-tdxed__row">
          <span className="es-tdxed__icon">
            <span className="es-tdx__tile" aria-hidden="true"><TierDetailIcon name={row.icon} size={22} /></span>
            <select className="es-input es-input--sm" aria-label="Icon" value={row.icon} onChange={(e) => update(i, { icon: e.target.value })}>
              {DETAIL_ICONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </span>
          {renderFields(row, (patch) => update(i, patch))}
          <span className="es-tdxed__tools">
            <button type="button" className="es-iconbtn es-iconbtn--sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
              <NavIcon name="chevronUp" size={16} />
            </button>
            <button type="button" className="es-iconbtn es-iconbtn--sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down">
              <NavIcon name="chevronDown" size={16} />
            </button>
            <button type="button" className="es-iconbtn es-iconbtn--sm" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove">
              <NavIcon name="trash" size={16} />
            </button>
          </span>
        </div>
      ))}

      {!full && (
        <div className="es-tdxed__chips">
          <button type="button" onClick={() => onChange([...rows, { ...blank }])}>
            <NavIcon name="plus" size={14} />Add your own
          </button>
          {suggestions.slice(0, 6).map((s) => (
            <button key={suggestionLabel(s)} type="button" onClick={() => onChange([...rows, { ...s }])}>
              <TierDetailIcon name={s.icon} size={14} />{suggestionLabel(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The photo: resized in the browser to a card-sized JPEG, signed, PUT straight
 * to storage, confirmed — the Venue Studio's steps against the tier endpoints.
 */
function PhotoField({ eventId, image, onChange }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function upload(file) {
    if (!file) return;
    setError(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError('Choose a JPEG, PNG or WebP image.'); return; }
    setBusy(true);
    try {
      const blob = await downscale(file, { width: 1800, height: 1000, quality: 0.85 });
      const signed = await post(`/events/${eventId}/tiers/image-upload`, { contentType: blob.type }, { noRedirect: true });
      if (blob.size > signed.maxBytes) throw new Error(`That image is larger than ${Math.round(signed.maxBytes / 1048576)} MB.`);
      const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
      if (!put.ok) throw new Error('The image did not upload. Try again.');
      const saved = await post(`/events/${eventId}/tiers/image`, { path: signed.path }, { noRedirect: true });
      onChange({ path: saved.path, url: saved.url });
    } catch (err) {
      setError(messageFor(err) || err.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="fx-stack fx-stack--sm gap-1">
      <span className="text-sm font-medium text-ink">Photo</span>
      <div className="es-tdxed__photo">
        <span className="es-tdxed__thumb">
          {image?.url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={image.url} alt="" />
            : <NavIcon name="image" size={26} />}
        </span>
        <span className="fx-stack fx-stack--sm gap-1">
          <span className="fx-row gap-2">
            <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => input.current?.click()} disabled={busy}>
              <NavIcon name="image" size={16} />{busy ? 'Uploading…' : image ? 'Replace photo' : 'Add a photo'}
            </button>
            {image && !busy && (
              <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => onChange(undefined)}>Remove</button>
            )}
          </span>
          <small className="text-xs text-subtle">Wide works best (about 16 : 9). Without one, the card uses your brand colours.</small>
        </span>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
