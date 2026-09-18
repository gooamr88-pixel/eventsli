'use client';

import { useState } from 'react';
import { put } from '../../utils/apiClient';
import { messageFor } from '../../utils/errors';
import { useToast } from '../../components/ui/Toast';
import { Panel } from '../../components/ui/Page';
import FormError from '../../components/forms/FormError';
import ImageField from './ImageField';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * One content block, rendered FROM THE SCHEMA rather than from a form written
 * by hand.
 *
 * `GET /admin/storefront/content` returns the values AND `blocks` — the field
 * list from `backend/utils/landingSchema.js`, with each field's type, label,
 * length limit and default. This component walks that list.
 *
 * WHY THAT MATTERS MORE THAN IT LOOKS. The alternative is a form here naming
 * every field, which is a second copy of the schema — and the copy is the one
 * nobody updates. A field added to the hero would save correctly through the
 * API, validate correctly, render correctly on the homepage, and be invisible
 * in the only place anyone could type it. Reading the schema means the console
 * cannot fall behind.
 *
 * `internal` fields (the storage object keys that travel with an image) are
 * filtered out server-side and never reach this list — they are set by
 * `ImageField` as a pair, because the API refuses one without the other.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function BlockForm({ block, values, onSaved }) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => ({ ...values }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  /** Dirty is computed, not tracked. A flag set by every onChange is a flag
   *  that survives a save and a reset unless every path remembers to clear it. */
  const dirty = block.fields.some((f) => (draft[f.name] ?? '') !== (values[f.name] ?? ''))
    || IMAGE_PAIRS.some(([url, path]) => (draft[path] ?? '') !== (values[path] ?? ''));

  const set = (name, value) => setDraft((d) => ({ ...d, [name]: value }));

  /** An image is two values and they must move together — the API refuses a
   *  URL with no object key and the reverse. */
  const setImage = (name, result) => {
    const pathField = PATH_FIELD[name];
    setDraft((d) => ({
      ...d,
      [name]: result?.url || '',
      ...(pathField ? { [pathField]: result?.path || '' } : {}),
    }));
  };

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await put(`/admin/storefront/content/${block.key}`, draft);
      toast.show(`${block.label} saved. The homepage is already showing it.`);
      onSaved?.(block.key, saved.value);
      setDraft({ ...saved.value });
    } catch (err) {
      // The API returns every complaint at once in `meta.errors`, so the
      // operator fixes one form rather than discovering a second problem after
      // fixing the first. Below that, `messageFor` rather than the raw
      // message: it still prefers the server's sentence, and falls back to the
      // code's recovery line instead of showing "Failed to fetch" when the
      // request never arrived.
      setError(err?.meta?.errors?.join(' ') || messageFor(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title={block.label}
      description={DESCRIPTIONS[block.key]}
      action={dirty ? <span className="es-pill es-pill--warning">Unsaved</span> : null}
    >
      <form onSubmit={save} className="fx-stack">
        {error && <FormError message={error} />}

        <div className="fx-grid fx-grid--2">
          {block.fields.map((field) => (
            <Field
              key={field.name}
              field={field}
              value={draft[field.name]}
              pathValue={PATH_FIELD[field.name] ? draft[PATH_FIELD[field.name]] : undefined}
              scope={SCOPE[block.key] || 'sections'}
              onChange={(v) => set(field.name, v)}
              onImage={(r) => setImage(field.name, r)}
            />
          ))}
        </div>

        <div className="fx-row fx-row--gap">
          <button type="submit" className="es-btn es-btn--primary" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="es-btn es-btn--ghost"
            disabled={saving || !dirty}
            onClick={() => { setDraft({ ...values }); setError(null); }}
          >
            Discard changes
          </button>
        </div>
      </form>
    </Panel>
  );
}

function Field({ field, value, pathValue, scope, onChange, onImage }) {
  const id = `content-${field.name}`;

  if (field.type === 'bool') {
    return (
      <label htmlFor={id} className="fx-row items-center gap-3">
        <input
          id={id}
          type="checkbox"
          checked={value !== false}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="text-sm text-ink">{field.label}</span>
      </label>
    );
  }

  if (field.type === 'image') {
    return (
      <div className="fx-stack fx-stack--sm">
        <span className="text-sm font-medium text-ink">{field.label}</span>
        <ImageField url={value} path={pathValue} scope={scope} onChange={onImage} />
      </div>
    );
  }

  const isLong = field.type === 'longtext';

  return (
    <div className="fx-stack fx-stack--sm">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {field.label}
        {field.optional && <span className="ms-1 text-subtle">(optional)</span>}
      </label>

      {isLong ? (
        <textarea
          id={id}
          rows={3}
          maxLength={field.max || undefined}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="es-input"
        />
      ) : (
        <input
          id={id}
          type="text"
          maxLength={field.max || undefined}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="es-input"
          // The API refuses anything that is not an internal path, and saying
          // so before the save is cheaper than saying so after it.
          placeholder={field.type === 'href' ? '/events' : undefined}
        />
      )}

      {field.type === 'href' && (
        <p className="text-xs text-subtle">A link inside Eventsli, like /events.</p>
      )}
      {field.type === 'video' && (
        <p className="text-xs text-subtle">A YouTube or Vimeo link, or an .mp4 or .webm file.</p>
      )}
      {field.max && !isLong && (
        <p className="text-xs text-subtle">{`${(value || '').length} / ${field.max}`}</p>
      )}
    </div>
  );
}

/** Which storage folder each block's images belong in. Matches
 *  `siteMediaService.SCOPES`; an unknown one is refused by the API. */
const SCOPE = {
  hero: 'hero',
  video: 'video',
  organizer_block: 'sections',
  guest_block: 'sections',
};

/** The url → object-key pairs the API insists move together. */
const IMAGE_PAIRS = [
  ['imageUrl', 'imagePath'],
  ['mobileImageUrl', 'mobileImagePath'],
  ['posterUrl', 'posterPath'],
];
const PATH_FIELD = Object.fromEntries(IMAGE_PAIRS);

const DESCRIPTIONS = {
  hero: 'The first screen. The background is two images — a wide one for desktops and a tall one for phones — because a panorama cropped to a phone is a picture of somebody’s shoulder.',
  video: 'Leave it switched off until there is a film. An empty video section is a control that looks playable and does nothing.',
  stats: 'Choose which figures appear and what they are called. The numbers themselves are counted from the database and cannot be typed.',
  organizer_block: 'The band addressed to people who run events.',
  guest_block: 'The band addressed to people buying tickets.',
  sections: 'The headings above each rail.',
};
