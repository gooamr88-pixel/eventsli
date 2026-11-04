'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { post, put, del, patch } from '../../../../utils/apiClient';
import NavIcon from '../../../../components/shell/NavIcon';
import FormError from '../../../../components/forms/FormError';
import { useConfirm } from '../../../../components/ui/Confirm';
import { useToast } from '../../../../components/ui/Toast';
import { IMAGE_ACCEPT } from './useContentSection';
import ContentCard from './ContentCard';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The event's own identity: a logo, a few highlights, and a pin on the map —
 * three cards, so Page & branding can set the logo beside the cover and the pin
 * beside the gallery. Each keeps its own busy and error state: a failed logo
 * upload has nothing to say inside the highlights.
 *
 * THE LOGO IS NOT A SECOND COVER. The cover is the photograph across the top of
 * the page — the thing that makes somebody stop scrolling. The logo is the mark
 * that says whose event this is, and it sits beside the title at a size where a
 * photograph would be unreadable. An organizer who sets one has not set the
 * other, and neither stands in for a missing one, so they are separate controls
 * with separate explanations rather than one "image" field.
 *
 * HIGHLIGHTS ARE PHRASES, NOT PARAGRAPHS. "Doors at 7", "18+", "Free parking" —
 * the facts somebody scans for before reading anything. The description is
 * where prose goes; a highlight that needs a comma is usually a sentence in the
 * wrong place, which is why the limit is short enough to make that obvious.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const MAX_HIGHLIGHTS = 12;

const editableOf = (event) => !['cancelled', 'completed'].includes(event.status);

/** busy + error around one async action, the shape all three cards share. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function LogoCard({ event, onChanged }) {
  const input = useRef(null);
  const confirm = useConfirm();
  const toast = useToast();
  const { busy, error, run } = useAction();
  const editable = editableOf(event);

  function uploadLogo(file) {
    if (!file) return;
    run(async () => {
      try {
        const signed = await post(`/events/${event.id}/cover-upload`, {
          contentType: file.type, slot: 'logo',
        }, { noRedirect: true });

        if (file.size > signed.maxBytes) {
          throw Object.assign(new Error(
            `That image is ${(file.size / 1048576).toFixed(1)} MB. The limit is `
            + `${Math.round(signed.maxBytes / 1048576)} MB.`,
          ), { code: 'VALIDATION_ERROR' });
        }

        const uploaded = await fetch(signed.uploadUrl, {
          method: 'PUT', headers: { 'Content-Type': file.type }, body: file,
        });
        if (!uploaded.ok) {
          throw Object.assign(new Error('The image did not upload. Try again.'), { code: 'CONFLICT' });
        }

        await put(`/events/${event.id}/logo`, { path: signed.path }, { noRedirect: true });
        toast.success('Logo updated.');
        onChanged();
      } finally {
        if (input.current) input.current.value = '';
      }
    });
  }

  async function removeLogo() {
    const ok = await confirm({
      title: 'Remove the logo?',
      tone: 'danger',
      body: <p>The file is deleted, so bringing it back means uploading it again. Your cover image is not affected.</p>,
      confirmLabel: 'Remove logo',
    });
    if (!ok) return;
    run(async () => {
      await del(`/events/${event.id}/logo`, { noRedirect: true });
      toast.success('Logo removed.');
      onChanged();
    });
  }

  const inputId = `logo-${event.id}`;
  return (
    <ContentCard
      icon="image"
      title="Event logo"
      description="Shown beside the event title. A square or wide mark on a plain background — not the cover photo."
    >
      {editable && (
        <input ref={input} id={inputId} type="file" accept={IMAGE_ACCEPT} className="sr-only"
          disabled={busy} onChange={(e) => uploadLogo(e.target.files?.[0])} />
      )}
      {event.logo ? (
        <div className="es-pblogo">
          <Image src={event.logo.url} alt="" width={240} height={96} className="h-full w-auto object-contain" />
        </div>
      ) : editable ? (
        <label htmlFor={inputId} aria-disabled={busy || undefined} className="es-pbdrop">
          <NavIcon name="image" size={28} />
          <b>{busy ? 'Uploading…' : 'Upload logo'}</b>
          <small>JPG, PNG or WebP</small>
        </label>
      ) : (
        <div className="es-pbdrop"><small>No logo</small></div>
      )}
      {event.logo && editable && (
        <div className="fx-row gap-2">
          <label htmlFor={inputId} aria-disabled={busy || undefined} className="es-btn es-btn--secondary es-btn--sm">
            {busy ? 'Working…' : 'Replace logo'}
          </label>
          <button type="button" onClick={removeLogo} disabled={busy} className="es-btn es-btn--ghost es-btn--sm">Remove</button>
        </div>
      )}
      <FormError error={error} />
    </ContentCard>
  );
}

export function HighlightsCard({ event, onChanged }) {
  const { busy, error, run } = useAction();
  const [highlight, setHighlight] = useState('');
  const highlights = Array.isArray(event.highlights) ? event.highlights : [];
  const full = highlights.length >= MAX_HIGHLIGHTS;

  /** Highlights are written as a whole list — the column IS the list, so there
   *  is nothing smaller to patch. */
  function saveHighlights(next) {
    run(async () => {
      await patch(`/events/${event.id}`, { highlights: next }, { noRedirect: true });
      onChanged();
    });
  }

  function addHighlight(e) {
    e.preventDefault();
    const text = highlight.trim();
    if (!text || full) return;
    setHighlight('');
    saveHighlights([...highlights, text]);
  }

  return (
    <ContentCard
      icon="star"
      title={<>Highlights <span className="es-pbcard__soft">(up to {MAX_HIGHLIGHTS})</span></>}
      description="Short facts people scan for before they read the full details."
      count={`${highlights.length} / ${MAX_HIGHLIGHTS}`}
    >
      {highlights.length > 0 && (
        <ul className="es-pbchips">
          {highlights.map((text, index) => (
            <li key={`${text}-${index}`} className="es-pbchip">
              <NavIcon name="sparkle" size={16} />
              <span>{text}</span>
              <button
                type="button"
                aria-label={`Remove highlight: ${text}`}
                disabled={busy}
                onClick={() => saveHighlights(highlights.filter((_, i) => i !== index))}
                className="es-pbchip__x"
              >
                <NavIcon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addHighlight} className="es-pbadd">
        <NavIcon name="plus" size={18} />
        <label htmlFor={`hl-${event.id}`} className="sr-only">Add a highlight</label>
        <input
          id={`hl-${event.id}`}
          maxLength={120}
          placeholder={full ? 'That is the lot — twelve is already more than most people read.' : 'Add a highlight (e.g. “VIP seating”, “Live DJ”) and press Enter'}
          value={highlight}
          onChange={(e) => setHighlight(e.target.value)}
          disabled={busy || full}
        />
        <button type="submit" disabled={busy || !highlight.trim() || full} className="es-btn es-btn--secondary es-btn--sm">
          Add
        </button>
      </form>
      <FormError error={error} />
    </ContentCard>
  );
}

export function MapPinCard({ event, onChanged }) {
  const toast = useToast();
  const { busy, error, run } = useAction();
  const pin = event.venueLocation;

  function saveLocation(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const lat = String(form.get('lat') || '').trim();
    const lng = String(form.get('lng') || '').trim();
    run(async () => {
      // Both or neither — the database refuses half a pin, and clearing one
      // field has to mean "remove the pin" rather than become a constraint error.
      await patch(`/events/${event.id}`, lat && lng
        ? { venueLat: Number(lat), venueLng: Number(lng) }
        : { venueLat: null, venueLng: null }, { noRedirect: true });
      toast.success(lat && lng ? 'Map pin saved.' : 'Map pin removed.');
      onChanged();
    });
  }

  return (
    <ContentCard icon="pin" title="Map pin" description="Puts a map on your event page. Optional — the address alone is enough for a well-known venue.">
      <form onSubmit={saveLocation} className="fx-stack fx-stack--sm">
        <div className="es-dgrid">
          <label className="fx-stack fx-stack--sm gap-1">
            <span className="text-sm font-semibold text-ink">Latitude</span>
            <input className="es-input" name="lat" inputMode="decimal" defaultValue={pin?.lat ?? ''} placeholder="43.6426" />
          </label>
          <label className="fx-stack fx-stack--sm gap-1">
            <span className="text-sm font-semibold text-ink">Longitude</span>
            <input className="es-input" name="lng" inputMode="decimal" defaultValue={pin?.lng ?? ''} placeholder="-79.3871" />
          </label>
        </div>
        <p className="text-xs text-subtle">
          Right-click the venue in Google Maps and copy the two numbers. Clear both to remove the map.
        </p>
        <div className="fx-row gap-2">
          <button type="submit" disabled={busy} className="es-btn es-btn--secondary es-btn--sm">Save map pin</button>
          {pin && (
            <a href={`https://www.google.com/maps?q=${pin.lat},${pin.lng}`} target="_blank" rel="noopener noreferrer" className="es-dcard__link">
              Check it on a map <NavIcon name="external" size={14} /><span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      </form>
      <FormError error={error} />
    </ContentCard>
  );
}
