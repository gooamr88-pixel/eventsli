'use client';

import { useId, useState } from 'react';
import Field, { SelectField, TextareaField } from '../../../../components/forms/Field';
import PlaceAutocomplete from '../../../../components/forms/PlaceAutocomplete';
import VenuePin from '../../../../components/forms/VenuePin';
import NavIcon from '../../../../components/shell/NavIcon';
import { categoryLabel } from '../../../../lib/categories';
import { zonesFor } from '../../../../lib/timezones';
import { MAX_HIGHLIGHTS } from './aiDraftModel';

/**
 * The editors behind the review page's "Edit" buttons, for the parts of the
 * event that are not tickets or schedule (those have their own files).
 *
 * Each is built from the components the manual wizard uses — `Field`,
 * `PlaceAutocomplete`, `VenuePin` — so a field means and validates exactly the
 * same thing whichever way the event was started.
 *
 * `errorFor(field)` is the problem list from `aiDraftModel.problemsFor`, so a
 * field says the same sentence the "needs you" row on the page does.
 */

/** Where an AI-filled time came from, in the organizer's words. */
function Source({ text }) {
  if (!text) return null;
  return <p className="es-ai-src"><NavIcon name="list" size={13} /> You wrote: &ldquo;{text}&rdquo;</p>;
}

export function EditBasics({ form, set, categories, errorFor }) {
  return (
    <div className="fx-stack fx-stack--sm">
      <Field
        label="Event title" name="title" required minLength={3} maxLength={200}
        value={form.title} onChange={(e) => set({ title: e.target.value })} error={errorFor('title')}
      />
      <SelectField
        label="Category" required value={form.category} onChange={(e) => set({ category: e.target.value })}
        options={categories?.length ? categories.map((c) => [c.slug, c.label]) : [[form.category, categoryLabel(form.category)]]}
        hint="Suggested by AI from Eventsli's categories. Change it if another fits better."
      />
    </div>
  );
}

export function EditAbout({ form, set }) {
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim().slice(0, 120);
    if (!value || form.highlights.includes(value) || form.highlights.length >= MAX_HIGHLIGHTS) return;
    set({ highlights: [...form.highlights, value] });
    setDraft('');
  };
  return (
    <div className="fx-stack fx-stack--sm">
      <TextareaField
        label="Description" optional rows={7} maxLength={5000} value={form.description}
        onChange={(e) => set({ description: e.target.value })}
        hint="Written by AI from your description. It is what buyers read, so check every sentence."
      />
      <div className="fx-stack fx-stack--sm gap-1.5">
        <label htmlFor={inputId} className="es-label"><span>Highlights</span><span className="es-optional">Optional</span></label>
        {form.highlights.length > 0 && (
          <ul className="es-ai-chipedit">
            {form.highlights.map((h) => (
              <li key={h}>
                <span>{h}</span>
                <button type="button" onClick={() => set({ highlights: form.highlights.filter((x) => x !== h) })} aria-label={`Remove ${h}`}>
                  <NavIcon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="es-ai-addrow">
          <input
            id={inputId} className="es-input" maxLength={120} value={draft} placeholder="e.g. Free parking"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            disabled={form.highlights.length >= MAX_HIGHLIGHTS}
          />
          <button type="button" className="es-btn es-btn--secondary" onClick={add} disabled={!draft.trim() || form.highlights.length >= MAX_HIGHLIGHTS}>Add</button>
        </div>
        <p className="es-nums text-xs text-subtle">{form.highlights.length} of {MAX_HIGHLIGHTS} · short phrases, up to 120 characters</p>
      </div>
    </div>
  );
}

export function EditWhen({ form, set, errorFor }) {
  const zone = zonesFor(form.country).find(([z]) => z === form.timezone);
  const zoneLabel = zone ? `${zone[1].split(' — ')[0]} time` : form.timezone;

  // The wizard's rule, kept: editing a name picked from venue search drops
  // that suggestion's pin, which would otherwise mark a different building.
  const setVenueName = (venueName) => set(form.venuePlaceId
    ? { venueName, venuePlaceId: '', venueLat: '', venueLng: '' }
    : { venueName });
  const applyPlace = (place) => {
    if (!place) return;
    set({
      venueName: place.name || form.venueName,
      venueAddress: place.address || form.venueAddress,
      city: place.city || form.city,
      venuePlaceId: place.placeId || '',
      venueLat: place.lat === null || place.lat === undefined ? '' : String(place.lat),
      venueLng: place.lng === null || place.lng === undefined ? '' : String(place.lng),
    });
  };

  return (
    <div className="fx-stack fx-stack--sm">
      <SelectField
        label="Time zone" required value={form.timezone} options={zonesFor(form.country)}
        onChange={(e) => set({ timezone: e.target.value })}
      />
      <div className="fx-stack fx-stack--sm gap-1">
        <Field
          label="Starts" type="datetime-local" name="startsAt" required hint={`Local time, ${zoneLabel}.`}
          value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} error={errorFor('startsAt')}
        />
        <Source text={form.startEvidence} />
      </div>
      <div className="fx-stack fx-stack--sm gap-1">
        <Field
          label="Ends" type="datetime-local" name="endsAt" required min={form.startsAt || undefined}
          value={form.endsAt} onChange={(e) => set({ endsAt: e.target.value })} error={errorFor('endsAt')}
        />
        <Source text={form.endEvidence} />
      </div>
      <PlaceAutocomplete
        label="Venue name" name="venueName" maxLength={200} country={form.country}
        value={form.venueName} onChange={setVenueName} onPlace={applyPlace}
      />
      <Field
        label="Street address" name="venueAddress" maxLength={300} autoComplete="street-address"
        value={form.venueAddress} onChange={(e) => set({ venueAddress: e.target.value })}
      />
      <Field
        label="City" name="city" maxLength={120} autoComplete="address-level2"
        hint="Buyers filter by city, and this is what puts your event in “near me”."
        value={form.city} onChange={(e) => set({ city: e.target.value })}
      />
      <VenuePin
        lat={form.venueLat} lng={form.venueLng} fromSearch={Boolean(form.venuePlaceId)}
        onChange={(k, v) => set({ [k]: v })}
      />
    </div>
  );
}
