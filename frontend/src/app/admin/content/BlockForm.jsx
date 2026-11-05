'use client';

import { Panel } from '../../components/ui/Page';
import FormError from '../../components/forms/FormError';
import NavIcon from '../../components/shell/NavIcon';
import ImageField from './ImageField';
import HeroPreview from './HeroPreview';

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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTROLLED SINCE 2026-11. The draft lives in Content.jsx, so ONE bar at the
 * foot of the page saves every block that changed — the page used to carry a
 * Save under each of six forms, folded shut, and an edit to two of them was
 * two saves somebody had to remember. Folding went with it: every block is
 * open, labels sit beside their inputs, and a block's `enabled` switch is in
 * its heading, where it reads as "is this on the homepage at all".
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function BlockForm({ block, draft, dirty, error, onField, onImage }) {
  const toggle = block.fields.find((f) => f.name === 'enabled' && f.type === 'bool');
  const fields = block.fields.filter((f) => f !== toggle);
  const scope = SCOPE[block.key] || 'sections';

  const form = (
    <div className="es-hform">
      {fields.map((field) => (
        <Field
          key={field.name}
          field={field}
          value={draft[field.name]}
          pathValue={PATH_FIELD[field.name] ? draft[PATH_FIELD[field.name]] : undefined}
          scope={scope}
          onChange={(v) => onField(field.name, v)}
          onImage={(r) => onImage(field.name, r)}
        />
      ))}
    </div>
  );

  return (
    <Panel
      icon={ICONS[block.key] || 'layers'}
      title={block.label}
      description={DESCRIPTIONS[block.key]}
      action={(
        <span className="fx-row items-center gap-3">
          {dirty && <span className="es-pill es-pill--warning">Unsaved</span>}
          {toggle && (
            <button
              type="button"
              role="switch"
              aria-checked={draft.enabled !== false}
              onClick={() => onField('enabled', draft.enabled === false)}
              className="es-switch"
            >
              <span className="es-switch__label">{toggle.label}</span>
              <span aria-hidden className="es-switch__track"><span className="es-switch__thumb" /></span>
            </button>
          )}
        </span>
      )}
    >
      {error && <FormError message={error} />}

      {block.key === 'hero' ? (
        <div className="es-blocksplit">
          {form}
          <HeroPreview draft={draft} />
        </div>
      ) : block.key === 'video' ? (
        <div className="es-blocksplit">
          {form}
          <VideoPreview draft={draft} />
        </div>
      ) : form}
    </Panel>
  );
}

/** What the video section will show. Not an embedded player: the console's
 *  CSP does not admit YouTube or Vimeo frames, and a player that cannot load
 *  is worse than a sentence saying what will appear. */
function VideoPreview({ draft }) {
  // The same reading as the switch above it: anything but an explicit false is on.
  const on = draft.enabled !== false;
  return (
    <div className="es-videoprev">
      {on && draft.posterUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element -- see ImageField */
        <img src={draft.posterUrl} alt="" className="es-videoprev__poster" />
      ) : null}
      <span className="es-videoprev__text">
        <NavIcon name="play" size={28} />
        <b>Video preview</b>
        <span>
          {!on
            ? 'Switch the section on and add a video URL to see it on the homepage.'
            : !draft.url
              ? 'Add a video URL — the section stays hidden without one.'
              : 'Shown on the homepage with this poster and title.'}
        </span>
      </span>
    </div>
  );
}

/** Is this draft different from what is saved? Computed, not tracked — a flag
 *  set by every onChange is one that survives a save and a reset unless every
 *  path remembers to clear it. */
export function isDirty(block, draft, values) {
  return block.fields.some((f) => (draft[f.name] ?? '') !== (values[f.name] ?? ''))
    || IMAGE_PAIRS.some(([, path]) => (draft[path] ?? '') !== (values[path] ?? ''));
}

function Field({ field, value, pathValue, scope, onChange, onImage }) {
  const id = `content-${field.name}`;

  if (field.type === 'bool') {
    return (
      <div className="es-hform__row">
        <span className="es-hform__label">{field.label}</span>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={value !== false}
          aria-label={field.label}
          onClick={() => onChange(value === false)}
          className="es-switch"
        >
          <span aria-hidden className="es-switch__track"><span className="es-switch__thumb" /></span>
          <span className="es-switch__label">{value !== false ? 'Shown' : 'Hidden'}</span>
        </button>
      </div>
    );
  }

  if (field.type === 'image') {
    return (
      <div className="es-hform__row">
        <span className="es-hform__label">{field.label}</span>
        <ImageField url={value} path={pathValue} scope={scope} onChange={onImage} />
      </div>
    );
  }

  const isLong = field.type === 'longtext';

  return (
    <div className="es-hform__row">
      <label htmlFor={id} className="es-hform__label">
        {field.label}
        {field.optional && <span className="ms-1 font-normal text-subtle">(optional)</span>}
      </label>

      <div className="fx-stack fx-stack--sm gap-1 fx-min0">
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
            placeholder={field.type === 'href' ? '/events' : field.type === 'video' ? 'https://www.youtube.com/watch?v=…' : undefined}
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
export const PATH_FIELD = Object.fromEntries(IMAGE_PAIRS);

const ICONS = {
  hero: 'image',
  video: 'play',
  stats: 'chart',
  organizer_block: 'briefcase',
  guest_block: 'ticket',
  sections: 'list',
};

const DESCRIPTIONS = {
  hero: 'The first screen. The background is two images — a wide one for desktops and a tall one for phones — because a panorama cropped to a phone is a picture of somebody’s shoulder.',
  video: 'Leave it switched off until there is a film. An empty video section is a control that looks playable and does nothing.',
  stats: 'Choose which figures appear and what they are called. The numbers themselves are counted from the database and cannot be typed.',
  organizer_block: 'The band addressed to people who run events.',
  guest_block: 'The band addressed to people buying tickets.',
  sections: 'The headings above each rail.',
};
