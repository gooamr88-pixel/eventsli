'use client';

import { useEffect, useRef, useState } from 'react';
import NavIcon from '../../components/shell/NavIcon';
import Hero from '../../components/landing/Hero';
import { get } from '../../utils/apiClient';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The hero as the homepage will draw it, from the UNSAVED draft — so a
 * headline can be tried at its real length before anyone presses Save.
 *
 * THE REAL HERO, NOT A LOOKALIKE (owner, 2026-11-19: "not the real shape of
 * landing page Hero"). This used to be an approximation — a dark box with a
 * background picture and centred words — and the homepage hero was rebuilt
 * on 2026-11-15 into something else entirely (white band, yellow highlight,
 * VIP slider, search bar), so the preview showed a page that no longer
 * existed. Now it renders `landing/Hero` itself with the draft as its content
 * and the live VIP events, so the two cannot drift apart again.
 *
 * HOW IT FITS: the hero is laid out at a real screen width — 1280px for
 * Desktop, 390px for Mobile — and scaled down to the panel. The hero's
 * breakpoints are container queries on its own width (see `.es-home-hero` in
 * globals.css), which is what lets the phone layout appear inside a desktop
 * window. `inert` makes it a picture: its links, buttons and search box do
 * nothing here and are skipped by the keyboard and screen readers.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const WIDTH = { desktop: 1280, mobile: 390 };
/** The phone is drawn at most this wide in the panel, so it reads as a phone. */
const PHONE_MAX = 300;

export default function HeroPreview({ draft }) {
  const [device, setDevice] = useState('desktop');
  const [vip, setVip] = useState([]);
  const [box, setBox] = useState({ scale: 0, height: 0 });
  const frameRef = useRef(null);
  const stageRef = useRef(null);
  const width = WIDTH[device];

  // The same slider the homepage shows. A failure costs the slider only.
  useEffect(() => {
    let live = true;
    get('/public/vip-events', { noRedirect: true })
      .then((d) => { if (live) setVip(Array.isArray(d?.events) ? d.events : []); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // Fit the full-size hero into the panel, and follow its height as the
  // headline wraps or the slider loads.
  useEffect(() => {
    const frame = frameRef.current;
    const stage = stageRef.current;
    if (!frame || !stage) return undefined;
    const measure = () => {
      const room = device === 'mobile' ? Math.min(frame.clientWidth, PHONE_MAX) : frame.clientWidth;
      const scale = Math.min(1, room / width);
      setBox({ scale, height: stage.offsetHeight * scale });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(stage);
    measure();
    return () => observer.disconnect();
  }, [device, width]);

  return (
    <section className="es-heroprev" aria-label="Live preview of the hero">
      <div className="es-heroprev__bar">
        <span className="es-heroprev__label"><NavIcon name="eye" size={18} />Live preview</span>
        <div className="es-heroprev__devices" role="group" aria-label="Preview size">
          {[['desktop', 'monitor', 'Desktop'], ['mobile', 'tablet', 'Mobile']].map(([key, icon, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={device === key}
              onClick={() => setDevice(key)}
              className="es-heroprev__device"
            >
              <NavIcon name={icon} size={16} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div ref={frameRef} className={`es-heroprev__frame es-heroprev__frame--${device}`}>
        <div
          className="es-heroprev__window"
          style={{ width: width * box.scale, height: box.height, visibility: box.scale ? 'visible' : 'hidden' }}
        >
          <div
            ref={stageRef}
            className="es-heroprev__stage"
            style={{ width, transform: `scale(${box.scale || 1})` }}
            inert
          >
            <Hero content={{ hero: draft }} vip={vip} />
          </div>
        </div>
      </div>
    </section>
  );
}
