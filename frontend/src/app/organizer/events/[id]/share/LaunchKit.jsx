'use client';

import { useEffect, useState } from 'react';
import { post } from '../../../../utils/apiClient';
import { useAiQuota } from '../../../../hooks/useAiQuota';
import { useToast } from '../../../../components/ui/Toast';
import FormError from '../../../../components/forms/FormError';
import NavIcon from '../../../../components/shell/NavIcon';
import { QuotaDots } from '../../new/ai/AiParts';
import { useEventContext } from '../EventContext';
import { FORMATS, dateLine, drawShareImage, loadImage } from './shareImage';
import { keepKey, keptWhen, readKept, writeKept } from '../../../../utils/localKeep';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The launch kit: everything an organizer needs to announce the event.
 *
 *   1. SHARE IMAGES — a square post and a story, drawn here from the event's
 *      own cover and facts (`shareImage.js`). Always available, no AI, free.
 *   2. POSTS WRITTEN FOR EACH CHANNEL — Instagram, Facebook, WhatsApp, email
 *      and X, by AI from the saved event, for one of the day's AI drafts. Each
 *      link is the real event URL tagged per channel, so the organizer can see
 *      which post sold. Prices, dates and links the event does not have are
 *      cut on the server (`backend/services/ai/launchKit.js`).
 *
 * Nothing is posted anywhere: the organizer copies, downloads or opens their
 * own app with the text filled in. The written kit IS kept in this browser,
 * per event (`localKeep.js`) — it cost a daily draft, and a reload used to
 * throw it away.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TONES = [['friendly', 'Friendly'], ['elegant', 'Elegant'], ['energetic', 'Energetic'], ['professional', 'Professional']];

function useCopy() {
  const toast = useToast();
  return async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied.`);
    } catch {
      toast.show('Copying is blocked here. Select the text and press Ctrl+C (or ⌘C).', { tone: 'success' });
    }
  };
}

export default function LaunchKit({ eventId, shareEvent }) {
  const ctx = useEventContext();
  const event = ctx?.event;
  const { quota, setQuota } = useAiQuota();
  const [kept] = useState(() => (eventId ? readKept(keepKey('launch-kit', eventId)) : null));
  const [tagline, setTagline] = useState(() => kept?.tagline || '');
  const [kit, setKit] = useState(() => kept?.kit || null);
  const [madeAt, setMadeAt] = useState(() => kept?.at || null);

  function keep(nextKit, nextTagline) {
    writeKept(keepKey('launch-kit', eventId), { kit: nextKit, tagline: nextTagline });
    setMadeAt(new Date().toISOString());
  }

  if (!event) return null;
  const info = {
    title: event.title,
    date: dateLine(event.startsAt, event.timezone),
    place: [event.venue?.name, event.city].filter(Boolean).join(' · '),
    tagline: tagline || (event.highlights || []).slice(0, 3).join(' · '),
    url: String(shareEvent?.url || '').replace(/^https?:\/\//, ''),
  };

  return (
    <section className="es-dcard" aria-labelledby="launch-kit">
      <div className="es-ovcard__head">
        <span className="es-ovcard__glyph" aria-hidden="true"><NavIcon name="layers" size={24} /></span>
        <div className="fx-min0">
          <h2 id="launch-kit" className="es-dcard__title">Launch kit</h2>
          <p className="es-ovcard__desc">
            Ready-to-use visuals for your promotions{quota?.enabled ? ', with AI-written copy for each channel' : ''}.
          </p>
        </div>
      </div>

      <ShareImages coverUrl={event.cover?.url || null} info={info} slug={event.slug} />

      {quota?.enabled && (
        <AiPosts
          eventId={eventId} quota={quota} setQuota={setQuota} kit={kit} madeAt={madeAt}
          onKit={(k) => {
            const first = k?.taglines?.[0] || '';
            setKit(k);
            setTagline(first);
            keep(k, first);
          }}
          tagline={tagline}
          onTagline={(t) => { setTagline(t); if (kit) keep(kit, t); }}
        />
      )}
    </section>
  );
}

function ShareImages({ coverUrl, info, slug }) {
  const [images, setImages] = useState({});
  const key = JSON.stringify(info);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cover = await loadImage(coverUrl);
      if (cancelled) return;
      const next = {};
      const draw = (format, withCover) => drawShareImage(format, JSON.parse(key), withCover).toDataURL('image/jpeg', 0.9);
      for (const format of Object.keys(FORMATS)) {
        try {
          next[format] = draw(format, cover);
        } catch {
          // A cover the browser would not let us read back: draw without it.
          // A browser with no canvas at all simply gets no images.
          try { next[format] = draw(format, null); } catch { /* left out */ }
        }
      }
      setImages(next);
    })();
    return () => { cancelled = true; };
  }, [coverUrl, key]);

  return (
    <div className="es-kit-images">
      {Object.entries(FORMATS).map(([format, f]) => (
        <figure key={format} className={`es-kit-image es-kit-image--${format}`}>
          <div className="es-kit-image__frame">
            {images[format]
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={images[format]} alt={`${f.label} image for this event`} />
              : <span className="es-skeleton es-kit-image__ghost" aria-hidden="true" />}
          </div>
          <figcaption className="es-kit-image__info">
            <span className="text-md font-semibold text-ink">{f.label}</span>
            <span className="text-xs text-muted">{f.hint}</span>
            <span className="es-ovchip self-start">{f.width} × {f.height}</span>
            <a
              className={`es-btn es-btn--primary es-btn--sm mt-auto self-start${images[format] ? '' : ' pointer-events-none opacity-50'}`}
              href={images[format] || undefined} download={`${slug}-${format}.jpg`} aria-disabled={!images[format] || undefined}
            >
              <NavIcon name="download" size={16} /> Download
            </a>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function AiPosts({ eventId, quota, setQuota, kit, madeAt, onKit, tagline, onTagline }) {
  const [tone, setTone] = useState('friendly');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const copy = useCopy();
  const exhausted = quota.remaining < 1;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const data = await post(`/ai/events/${eventId}/launch-kit`, {
        requestId: crypto.randomUUID(), tone, ...(note.trim() ? { note: note.trim() } : {}),
      }, { noRedirect: true });
      onKit(data.kit);
      if (data.quota) setQuota(data.quota);
    } catch (err) {
      setError(err);
      if (err?.code === 'AI_QUOTA_EXHAUSTED') setQuota((q) => ({ ...(q || {}), remaining: 0 }));
    } finally {
      setBusy(false);
    }
  }

  const ig = kit ? [kit.instagram, kit.hashtags.join(' ')].filter(Boolean).join('\n\n') : '';
  const channels = kit ? [
    ['Instagram', 'image', ig, null],
    ['Facebook', 'users', kit.facebook, null],
    ['WhatsApp', 'chat', kit.whatsapp, `https://wa.me/?text=${encodeURIComponent(kit.whatsapp)}`],
    ['X', 'globe', kit.x, `https://twitter.com/intent/tweet?text=${encodeURIComponent(kit.x)}`],
    ['Email', 'mail', `${kit.email.subject}\n\n${kit.email.body}`,
      `mailto:?subject=${encodeURIComponent(kit.email.subject)}&body=${encodeURIComponent(kit.email.body)}`],
  ].filter(([, , text]) => text) : [];

  return (
    <div className="es-kit-ai fx-stack">
      <div className="fx-row flex-wrap items-end gap-3">
        <label className="fx-stack fx-stack--sm gap-1">
          <span className="text-sm font-medium text-ink">Tone</span>
          <select className="es-input" value={tone} onChange={(e) => setTone(e.target.value)} disabled={busy}>
            {TONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="fx-stack fx-stack--sm fx-min0 flex-1 gap-1">
          <span className="text-sm font-medium text-ink">Anything to mention? <span className="text-subtle">Optional</span></span>
          <input
            className="es-input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy}
            placeholder="e.g. Dress code is all white. Early-bird ends Friday."
          />
        </label>
        <button type="button" className="es-btn es-btn--primary" onClick={generate} disabled={busy || exhausted}>
          {busy ? <><span className="es-ai-spin" aria-hidden="true" /> Writing…</> : <><NavIcon name="sparkle" size={16} /> {kit ? 'Write again' : 'Write my posts'}</>}
        </button>
      </div>
      <p className="fx-row items-center gap-2 text-xs text-subtle">
        {exhausted ? 'No AI drafts left today.' : <QuotaDots quota={quota} />}
        <span>Uses 1 AI draft. Written only from your event&rsquo;s own details.</span>
      </p>
      <FormError error={error} />

      {kit && (
        <>
          {madeAt && (
            <p className="text-xs text-subtle">
              Written {keptWhen(madeAt)} and kept in this browser. Writing again uses another AI draft.
            </p>
          )}
          {kit.taglines.length > 0 && (
            <div className="fx-stack fx-stack--sm gap-1">
              <span className="text-sm font-medium text-ink">Line on the images</span>
              <div className="fx-row flex-wrap gap-2" role="radiogroup" aria-label="Line on the images">
                {kit.taglines.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={tagline === t}
                    className={`es-kit-chip${tagline === t ? ' is-on' : ''}`} onClick={() => onTagline(t)}>{t}</button>
                ))}
              </div>
            </div>
          )}
          <ul className="es-kit-posts">
            {channels.map(([name, icon, text, open]) => (
              <li key={name} className="es-kit-post">
                <div className="fx-row fx-row--between items-center gap-2">
                  <span className="fx-row items-center gap-2 font-medium text-ink"><NavIcon name={icon} size={16} /> {name}</span>
                  <span className="fx-row gap-2">
                    {open && (
                      <a className="es-btn es-btn--ghost es-btn--sm" href={open} target="_blank" rel="noreferrer noopener">
                        Open <NavIcon name="external" size={14} />
                      </a>
                    )}
                    <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => copy(text, `The ${name} post`)}>
                      <NavIcon name="copy" size={14} /> Copy
                    </button>
                  </span>
                </div>
                <p className="es-kit-post__text fx-break">{text}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-subtle">
            Each link carries a tag for its channel (utm_source), so your analytics show which post brought buyers. Read
            every post once before you share it.
          </p>
        </>
      )}
    </div>
  );
}
