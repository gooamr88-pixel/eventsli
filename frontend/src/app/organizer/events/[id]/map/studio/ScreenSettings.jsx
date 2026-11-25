'use client';

import { useRef, useState } from 'react';
import NavIcon from '../../../../../components/shell/NavIcon';
import { messageFor } from '../../../../../utils/errors';
import { studioId } from '../../../../../components/venue/venueModel';
import {
  SLIDE_KINDS, SCREEN_STYLES, TRANSITIONS, SOUND_PRESETS, SOUND_SOURCES, SLIDE_SECONDS, MAX_SLIDES, PRESET_FOR_MOOD,
} from '../../../../../components/venue/stage/screenModel';
import ScreenPreview from '../../../../../components/venue/stage/ScreenPreview';
import {
  TextField, RangeField, Toggle, Segmented, ColourField, SelectField,
} from '../../../../../components/inspector/fields';
import { InspectorSection, InspectorNote } from '../../../../../components/inspector/Inspector';
import { uploadStudioImage, uploadStudioAudio } from './uploadStudioImage';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STAGE SCREEN'S SETTINGS (2026-11-25): what the LED wall in the 3D room
 * plays, how it looks and what music Showtime plays.
 *
 * Three folding groups under a live preview:
 *   • ON THE SCREEN — the slides, in order. Title, countdown, lineup and
 *     sponsors fill themselves from the event; a headliner, a photo and a
 *     message are the organizer's own. A slide with nothing to show (a
 *     lineup with no schedule) is skipped on the screen, and says so here.
 *   • LOOK — the style, the accent colour, the transition, the timing, the
 *     LED finish, the screen's size and the side screens.
 *   • MUSIC — Eventsli's own loops, the organizer's track, or none.
 *
 * Every change is the draft's (useStudioDraft, `scene.screen`) and saves with
 * the map. The screen's SHAPE is not a setting: it is always 16:9.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ScreenSettings({ eventId, screen, mood, feed, title, onChange }) {
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState('');
  const set = (patch) => onChange({ ...screen, ...patch });
  const setSlides = (slides) => set({ slides });
  const setSlide = (id, patch) => setSlides(screen.slides.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (i, dir) => {
    const list = [...screen.slides];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setSlides(list);
  };
  const add = (kind) => {
    if (!kind || screen.slides.length >= MAX_SLIDES) return;
    const slide = { id: studioId('sl'), kind };
    if (kind === 'artist' || kind === 'photo') slide.focus = { x: 50, y: 40 };
    setSlides([...screen.slides, slide]);
    if (['artist', 'photo', 'message'].includes(kind)) setOpen(slide.id);
    setAdding('');
  };

  const autoPreset = SOUND_PRESETS.find((p) => p.key === PRESET_FOR_MOOD[mood])?.label || 'Arena';

  return (
    <div className="fx-stack es-screenset">
      <div>
        <ScreenPreview screen={screen} feed={feed} title={title} />
        <p className="es-field__hint">Always landscape, 16:9. Press it, or the screen in the room, for the next slide.</p>
      </div>

      <InspectorSection id="screen-slides" title="On the screen" summary={`${screen.slides.length} slides`}>
        <ol className="es-screenset__slides">
          {screen.slides.map((s, i) => {
            const kind = SLIDE_KINDS.find((k) => k.key === s.kind);
            const editable = ['artist', 'photo', 'message'].includes(s.kind);
            const empty = emptyReason(s, feed);
            const isOpen = open === s.id;
            return (
              <li key={s.id} className="es-screenset__slide" data-open={isOpen ? 'true' : 'false'}>
                <div className="es-screenset__row">
                  <NavIcon name={kind.icon} size={16} />
                  <span className="fx-min0 fx-stack">
                    <span className="es-screenset__name fx-truncate">{slideName(s, kind)}</span>
                    {empty && <span className="es-screenset__warn">{empty}</span>}
                  </span>
                  <span className="es-screenset__acts">
                    {editable && (
                      <button type="button" className="es-fbtn" aria-expanded={isOpen} aria-label={`Edit ${kind.label}`} title="Edit" onClick={() => setOpen(isOpen ? null : s.id)}>
                        <NavIcon name="pencil" size={15} />
                      </button>
                    )}
                    <button type="button" className="es-fbtn" disabled={i === 0} aria-label={`Move ${kind.label} up`} title="Move up" onClick={() => move(i, -1)}>
                      <NavIcon name="chevronUp" size={15} />
                    </button>
                    <button type="button" className="es-fbtn" disabled={i === screen.slides.length - 1} aria-label={`Move ${kind.label} down`} title="Move down" onClick={() => move(i, 1)}>
                      <NavIcon name="chevronDown" size={15} />
                    </button>
                    <button type="button" className="es-fbtn" aria-label={`Remove ${kind.label}`} title="Remove" onClick={() => setSlides(screen.slides.filter((x) => x.id !== s.id))}>
                      <NavIcon name="trash" size={15} />
                    </button>
                  </span>
                </div>
                {isOpen && editable && (
                  <div className="es-screenset__edit fx-stack">
                    <SlideFields eventId={eventId} slide={s} onChange={(patch) => setSlide(s.id, patch)} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {screen.slides.length === 0 && <InspectorNote>With no slides the screen shows the event’s name.</InspectorNote>}
        <SelectField
          label="Add a slide" value={adding} placeholder={screen.slides.length >= MAX_SLIDES ? `Up to ${MAX_SLIDES} slides` : 'Choose…'}
          disabled={screen.slides.length >= MAX_SLIDES}
          onChange={add}
          options={SLIDE_KINDS.map((k) => [k.key, k.label])}
          hint={adding ? null : 'Title, countdown, lineup and sponsors fill themselves from your event.'}
        />
      </InspectorSection>

      <InspectorSection id="screen-look" title="Look" summary={SCREEN_STYLES.find((x) => x.key === screen.style)?.label}>
        <Segmented stacked label="Style" value={screen.style} onChange={(style) => set({ style })} options={SCREEN_STYLES} />
        <ColourField label="Accent colour" value={screen.accent} fallback={screen.style === 'elegant' ? '#d4a72c' : screen.style === 'neon' ? '#ff2d75' : '#ff414b'} emptyText="Style's own" onChange={(accent) => set({ accent })} />
        <Segmented label="Transition" value={screen.transition} onChange={(transition) => set({ transition })} options={TRANSITIONS} />
        <RangeField
          label="Each slide" value={screen.seconds} min={SLIDE_SECONDS.min} max={SLIDE_SECONDS.max}
          onChange={(seconds) => set({ seconds })} format={(v) => `${v} s`}
        />
        <Toggle label="LED finish" hint="A fine pixel grid, like a real stage wall." checked={screen.pixels} onChange={(pixels) => set({ pixels })} />
        <RangeField
          label="Screen size" value={screen.size} min={60} max={100} step={5}
          onChange={(size) => set({ size })} format={(v) => `${v}%`} hint="Of the largest screen that fits over your stage."
        />
        <Toggle label="Side screens" hint="Two smaller screens either side, for the seats far round." checked={screen.sides} onChange={(sides) => set({ sides })} />
      </InspectorSection>

      <InspectorSection id="screen-music" title="Music" summary={SOUND_SOURCES.find((x) => x.key === screen.sound.source)?.label}>
        <Segmented
          stacked label="Showtime plays" value={screen.sound.source}
          onChange={(source) => set({ sound: { ...screen.sound, source } })} options={SOUND_SOURCES}
        />
        {screen.sound.source === 'preset' && (
          <SelectField
            label="Music" value={screen.sound.preset || 'auto'}
            onChange={(v) => set({ sound: { ...screen.sound, preset: v === 'auto' ? null : v } })}
            options={[['auto', `Match the lighting (${autoPreset})`], ...SOUND_PRESETS.map((p) => [p.key, `${p.label} — ${p.hint}`])]}
            hint="Made by Eventsli and played in the buyer’s browser: nothing to license."
          />
        )}
        {screen.sound.source === 'track' && (
          <TrackField eventId={eventId} track={screen.sound.track} onChange={(track) => set({ sound: { ...screen.sound, track } })} />
        )}
        {screen.sound.source !== 'off' && (
          <RangeField
            label="Volume" value={screen.sound.volume} min={10} max={100} step={5}
            onChange={(volume) => set({ sound: { ...screen.sound, volume } })} format={(v) => `${v}%`}
          />
        )}
        <Toggle
          label="Lights follow the music" hint="In Showtime the stage beams, the rim and the screen’s glow pulse with the beat."
          checked={screen.react} onChange={(react) => set({ react })}
        />
        <InspectorNote>Buyers start it with Showtime in the 3D view. Nothing ever plays by itself.</InspectorNote>
      </InspectorSection>
    </div>
  );
}

function slideName(s, kind) {
  if (s.kind === 'artist' && s.name) return `${kind.label}: ${s.name}`;
  if (s.kind === 'message' && s.text) return `“${s.text}”`;
  if (s.kind === 'photo' && s.caption) return `${kind.label}: ${s.caption}`;
  return kind.label;
}

/** Why a slide will be skipped on the screen, or null when it will show. */
export function emptyReason(s, feed) {
  if (s.kind === 'lineup' && !feed?.lineup?.length) return 'Skipped until the event has a schedule';
  if (s.kind === 'sponsors' && !feed?.sponsors?.length) return 'Skipped until the event has sponsors';
  if (s.kind === 'photo' && !s.image) return 'Skipped until it has a photo';
  if (s.kind === 'artist' && !s.image && !s.name) return 'Add a name or a photo';
  if (s.kind === 'message' && !s.text) return 'Skipped until it has words';
  if (s.kind === 'countdown' && !feed?.startsAt) return 'Skipped until the event has a date';
  return null;
}

function SlideFields({ eventId, slide, onChange }) {
  if (slide.kind === 'message') {
    return (
      <>
        <TextField label="Message" value={slide.text || ''} maxLength={80} onChange={(text) => onChange({ text })} placeholder="Welcome to the Winter Gala" />
        <TextField label="Small line" value={slide.sub || ''} maxLength={80} onChange={(sub) => onChange({ sub })} placeholder="#WinterGala · Black tie" />
      </>
    );
  }
  return (
    <>
      <PhotoField eventId={eventId} slide={slide} onChange={onChange} />
      {slide.kind === 'artist' ? (
        <>
          <TextField label="Name" value={slide.name || ''} maxLength={60} onChange={(name) => onChange({ name })} placeholder="The headliner" />
          <TextField label="Line above the name" value={slide.tagline || ''} maxLength={80} onChange={(tagline) => onChange({ tagline })} placeholder="Live in concert" />
        </>
      ) : (
        <TextField label="Caption" value={slide.caption || ''} maxLength={100} onChange={(caption) => onChange({ caption })} placeholder="Doors open at 7" />
      )}
    </>
  );
}

function PhotoField({ eventId, slide, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const onFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const asset = await uploadStudioImage(eventId, file, 'screen');
      onChange({ image: { path: asset.path, url: asset.url }, focus: slide.focus || { x: 50, y: 40 } });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  const focus = slide.focus || { x: 50, y: 40 };
  return (
    <div className="fx-stack gap-2">
      <div className="fx-row gap-2">
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => ref.current?.click()} disabled={busy}>
          <NavIcon name="image" size={15} /> {busy ? 'Uploading…' : slide.image ? 'Replace photo' : 'Add a photo'}
        </button>
        {slide.image && (
          <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => onChange({ image: null })}>Remove</button>
        )}
      </div>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Slide photo" onChange={(e) => onFile(e.target.files?.[0])} />
      {slide.image && (
        <>
          <p className="es-field__hint">Any shape works: the screen shows it 16:9, around the point you keep in view.</p>
          <RangeField label="Keep in view, across" value={focus.x} min={0} max={100} onChange={(x) => onChange({ focus: { ...focus, x } })} format={(v) => `${v}%`} />
          <RangeField label="Keep in view, down" value={focus.y} min={0} max={100} onChange={(y) => onChange({ focus: { ...focus, y } })} format={(v) => `${v}%`} />
        </>
      )}
      {error && <p role="alert" className="text-sm text-danger">{messageFor(error)}</p>}
    </div>
  );
}

function TrackField({ eventId, track, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const onFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const asset = await uploadStudioAudio(eventId, file);
      onChange({ path: asset.path, url: asset.url, name: asset.name });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  return (
    <div className="fx-stack gap-2">
      {track ? (
        <TextField label="Track title" value={track.name || ''} maxLength={80} onChange={(name) => onChange({ ...track, name })} hint="Shown beside Showtime while it plays." />
      ) : (
        <p className="es-field__hint">An MP3 or M4A, up to 8 MB (about four minutes). It loops.</p>
      )}
      <div className="fx-row gap-2">
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => ref.current?.click()} disabled={busy}>
          <NavIcon name="music" size={15} /> {busy ? 'Uploading…' : track ? 'Replace track' : 'Upload a track'}
        </button>
        {track && <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => onChange(null)}>Remove</button>}
      </div>
      <input ref={ref} type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,.mp3,.m4a" className="sr-only" aria-label="Soundtrack" onChange={(e) => onFile(e.target.files?.[0])} />
      <InspectorNote>Upload only music you have the rights to play in public. Until a track is added, Showtime plays Eventsli music.</InspectorNote>
      {error && <p role="alert" className="text-sm text-danger">{messageFor(error)}</p>}
    </div>
  );
}
