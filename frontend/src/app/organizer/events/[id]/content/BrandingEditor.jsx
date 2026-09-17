'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { post, put, del, patch } from '../../../../utils/apiClient';
import { Panel } from '../../../../components/ui/Page';
import FormError from '../../../../components/forms/FormError';
import { useConfirm } from '../../../../components/ui/Confirm';
import { useToast } from '../../../../components/ui/Toast';
import { IMAGE_ACCEPT } from './useContentSection';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The event's own identity: a logo, a few highlights, and a pin on the map.
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
const MAX_HIGHLIGHTS = 12;

export default function BrandingEditor({ event, onChanged }) {
  const input = useRef(null);
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [highlight, setHighlight] = useState('');

  const highlights = Array.isArray(event.highlights) ? event.highlights : [];
  const editable = !['cancelled', 'completed'].includes(event.status);

  async function uploadLogo(file) {
    if (!file) return;
    setBusy(true);
    setError(null);
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
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function removeLogo() {
    const ok = await confirm({
      title: 'Remove the logo?',
      tone: 'danger',
      body: <p>The file is deleted, so bringing it back means uploading it again. Your cover image is not affected.</p>,
      confirmLabel: 'Remove logo',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await del(`/events/${event.id}/logo`, { noRedirect: true });
      toast.success('Logo removed.');
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /** Highlights are written as a whole list — the column IS the list, so there
   *  is nothing smaller to patch. */
  async function saveHighlights(next) {
    setBusy(true);
    setError(null);
    try {
      await patch(`/events/${event.id}`, { highlights: next }, { noRedirect: true });
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function addHighlight(e) {
    e.preventDefault();
    const text = highlight.trim();
    if (!text || highlights.length >= MAX_HIGHLIGHTS) return;
    setHighlight('');
    saveHighlights([...highlights, text]);
  }

  async function saveLocation(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const lat = String(form.get('lat') || '').trim();
    const lng = String(form.get('lng') || '').trim();

    setBusy(true);
    setError(null);
    try {
      // Both or neither — the database refuses half a pin, and clearing one
      // field has to mean "remove the pin" rather than become a constraint error.
      await patch(`/events/${event.id}`, lat && lng
        ? { venueLat: Number(lat), venueLng: Number(lng) }
        : { venueLat: null, venueLng: null }, { noRedirect: true });
      toast.success(lat && lng ? 'Map pin saved.' : 'Map pin removed.');
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel
        title="Event logo"
        description="Shown beside your event title. A square or wide mark on a plain background works best — this is not the cover photo."
        action={event.logo && editable && (
          <button type="button" onClick={removeLogo} disabled={busy} className="es-btn es-btn--ghost es-btn--sm">
            Remove
          </button>
        )}
      >
        {event.logo ? (
          <div className="grid h-24 w-full max-w-64 place-items-center overflow-hidden rounded-(--es-radius-md) bg-bg-sunken p-3">
            <Image src={event.logo.url} alt="" width={240} height={96} className="h-full w-auto object-contain" />
          </div>
        ) : (
          <div className="grid h-24 w-full max-w-64 place-items-center rounded-(--es-radius-md) border border-dashed border-border-strong bg-bg-sunken">
            <p className="text-sm text-subtle">No logo</p>
          </div>
        )}

        <FormError error={error} />

        {editable && (
          <>
            <input
              ref={input}
              id={`logo-${event.id}`}
              type="file"
              accept={IMAGE_ACCEPT}
              className="sr-only"
              disabled={busy}
              onChange={(e) => uploadLogo(e.target.files?.[0])}
            />
            <label
              htmlFor={`logo-${event.id}`}
              aria-disabled={busy || undefined}
              className="es-btn es-btn--secondary self-start"
            >
              {busy ? 'Working…' : event.logo ? 'Replace logo' : 'Choose a logo'}
            </label>
          </>
        )}
      </Panel>

      <Panel
        title="Highlights"
        description="Short facts people scan for before they read anything. Up to twelve."
      >
        {highlights.length > 0 && (
          <ul className="fx-row flex-wrap gap-2">
            {highlights.map((text, index) => (
              <li
                key={`${text}-${index}`}
                className="fx-row items-center gap-1.5 rounded-full border border-border-base bg-bg-sunken py-1 pl-3 pr-1.5 text-sm text-ink"
              >
                <span>{text}</span>
                <button
                  type="button"
                  aria-label={`Remove highlight: ${text}`}
                  disabled={busy}
                  onClick={() => saveHighlights(highlights.filter((_, i) => i !== index))}
                  className="grid h-5 w-5 place-items-center rounded-full text-subtle transition-colors hover:bg-surface hover:text-ink"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addHighlight} className="fx-row flex-wrap items-end gap-2">
          <label className="fx-stack fx-stack--sm fx-min0 flex-1 gap-1">
            <span className="text-sm text-ink">Add a highlight</span>
            <input
              className="es-input"
              maxLength={120}
              placeholder="Doors at 7pm"
              value={highlight}
              onChange={(e) => setHighlight(e.target.value)}
              disabled={busy || highlights.length >= MAX_HIGHLIGHTS}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !highlight.trim() || highlights.length >= MAX_HIGHLIGHTS}
            className="es-btn es-btn--secondary"
          >
            Add
          </button>
        </form>
        {highlights.length >= MAX_HIGHLIGHTS && (
          <p className="text-xs text-subtle">That is the lot — twelve is already more than most people read.</p>
        )}
      </Panel>

      <Panel
        title="Map pin"
        description="Puts a map on your event page. Optional — the address alone is enough for a well-known venue."
      >
        <form onSubmit={saveLocation} className="fx-stack fx-stack--sm">
          <div className="fx-grid" style={{ '--fx-col': '180px', '--fx-gap': '10px' }}>
            <label className="fx-stack fx-stack--sm gap-1">
              <span className="text-sm text-ink">Latitude</span>
              <input
                className="es-input" name="lat" inputMode="decimal"
                defaultValue={event.venueLocation?.lat ?? ''}
                placeholder="43.6426"
              />
            </label>
            <label className="fx-stack fx-stack--sm gap-1">
              <span className="text-sm text-ink">Longitude</span>
              <input
                className="es-input" name="lng" inputMode="decimal"
                defaultValue={event.venueLocation?.lng ?? ''}
                placeholder="-79.3871"
              />
            </label>
          </div>
          <p className="text-xs text-subtle">
            Find these by right-clicking the venue in Google Maps and copying the two numbers.
            Clear both fields to remove the map.
          </p>
          <button type="submit" disabled={busy} className="es-btn es-btn--secondary self-start">
            Save map pin
          </button>
        </form>
      </Panel>
    </>
  );
}
