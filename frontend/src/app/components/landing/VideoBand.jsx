'use client';

import { useState } from 'react';
import NavIcon from '../shell/NavIcon';
import Accent from './Accent';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The introduction film.
 *
 * SHIPS EMPTY, AND THAT IS THE REQUIREMENT. The storefront brief asked for the
 * section to exist in the design and in the admin console with no film in it
 * yet. `landingSchema.video` therefore defaults `enabled` to false and carries
 * no URL, so this component returns null until somebody supplies one.
 *
 * An empty <video> element is not a placeholder. It is a control that looks
 * playable and does nothing, which is worse than an absent section.
 *
 * ── Click to load ──────────────────────────────────────────────────────────
 * Nothing is fetched until the play button is pressed. A YouTube <iframe> on
 * page load pulls roughly a megabyte of player and sets cookies for a third
 * party before anyone has decided to watch anything — on a marketing page, for
 * a film most visitors will scroll past. The poster is an <img> from our own
 * bucket; the embed replaces it on click.
 *
 * That is also what keeps the CSP honest: `frame-src` admits YouTube and Vimeo,
 * but no frame is created at all unless a visitor asks for one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VideoBand({ block }) {
  const [playing, setPlaying] = useState(false);

  if (!block || block.enabled === false || !block.url) return null;

  const embed = embedUrl(block.url);

  return (
    <section id="watch" className="es-band fx-section fx-section--sm">
      <div className="fx-container fx-container--xl">
        <div className="es-lp-head">
          <div>
            <p className="es-lp-kicker">Highlights</p>
            <h2 className="es-lp-title"><Accent text={block.title || 'Watch the night happen'} lastWord /></h2>
            {block.caption && <p className="es-lp-lede">{block.caption}</p>}
          </div>
        </div>

        <div className="es-lp-film">
          {playing ? (
            embed ? (
              <iframe
                src={embed}
                title={block.title || 'Eventsli'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              /* A file rather than an embed. `controls` and no `loop`: this is
                 a film somebody chose to watch, not a background texture. */
              <video src={block.url} controls autoPlay playsInline poster={block.posterUrl || undefined}>
                <track kind="captions" />
              </video>
            )
          ) : (
            <>
              {block.posterUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- the tile sets its own aspect-ratio and object-fit; `fill` would fight it
                <img src={block.posterUrl} alt="" loading="lazy" decoding="async" />
              )}
              <button type="button" onClick={() => setPlaying(true)} className="es-lp-film__play">
                <span aria-hidden><NavIcon name="play" size={28} filled /></span>
                <span className="sr-only">{`Play${block.title ? `: ${block.title.replace(/\*/g, '')}` : ' the video'}`}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * A watch URL turned into an embed URL, or null for a plain video file.
 *
 * Only the two hosts `landingSchema` accepts are recognised — anything else has
 * already been refused at the point of saving, so an unrecognised URL here is a
 * direct `.mp4`/`.webm` and is played by <video>.
 *
 * Returning null rather than guessing matters: an embed URL built from a host
 * we do not understand would be blocked by `frame-src` and render an empty
 * white box with no error anywhere a developer would see it.
 */
export function embedUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1);
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1&rel=0` : null;
  }
  if (host === 'youtube.com') {
    // Both spellings: /watch?v=ID and an /embed/ID somebody pasted already.
    const id = url.searchParams.get('v') || url.pathname.match(/\/embed\/([\w-]+)/)?.[1];
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1&rel=0` : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.match(/(\d{6,})/)?.[1];
    return id ? `https://player.vimeo.com/video/${id}?autoplay=1` : null;
  }
  return null;
}
