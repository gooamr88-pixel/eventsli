'use client';

import { useState } from 'react';
import NavIcon from '../../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SHOWTIME: the one button that makes the 3D room come alive (2026-11-25).
 *
 * Lights down, music up. The house lights fade, the beams over the stage take
 * the screen's colour and swing to the beat, the rim pulses, and the
 * soundtrack plays from the stage — so a buyer who then sits in a seat (360°)
 * hears the show from there. Again: lights up, and the music fades out.
 *
 * Nothing about it is automatic. The music starts only from this tap (the
 * browser allows nothing else, and a seat map that blared on opening would
 * be worse than silent), and the camera never moves (map-stays-still).
 *
 * `controls` is the 3D view's handle (VenueScene3D's `controlsRef`); the call
 * is made inside the click so the soundtrack may start.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ShowtimeBar({ controls, hasSound = true, trackFailed = false, volume: startVolume = 85, className = '' }) {
  const [on, setOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(null);
  // The listener's own volume, starting at the organizer's.
  const [volume, setVolume] = useState(startVolume);

  const toggle = () => {
    const next = !on;
    const result = controls.current?.showtime?.(next);
    // The room has not drawn yet: nothing to switch.
    if (!result) return;
    setOn(next);
    setPlaying(next && result.sound ? result.name : null);
    if (next) controls.current?.volume?.(volume / 100);
    if (next && muted) controls.current?.mute?.(true);
  };

  const changeVolume = (v) => {
    setVolume(v);
    controls.current?.volume?.(v / 100);
    if (muted && v > 0) { controls.current?.mute?.(false); setMuted(false); }
  };

  const toggleMute = () => {
    const next = !muted;
    controls.current?.mute?.(next);
    setMuted(next);
  };

  const name = trackFailed ? 'Eventsli music' : playing;

  return (
    <div className={`es-showtime ${className}`.trim()} data-on={on ? 'true' : 'false'}>
      <button
        type="button" className="es-showtime__go" aria-pressed={on} onClick={toggle}
        title={on ? 'Bring the house lights up' : hasSound ? 'Lights down, music on' : 'Lights down'}
      >
        <NavIcon name={on ? 'bulb' : 'sparkle'} size={16} />
        <span>{on ? 'Lights up' : 'Showtime'}</span>
      </button>
      {on && name && (
        <>
          <button
            type="button" className="es-showtime__mute" aria-pressed={muted}
            aria-label={muted ? 'Turn the music on' : 'Mute the music'} title={muted ? 'Sound on' : 'Mute'}
            onClick={toggleMute}
          >
            <Speaker muted={muted} />
          </button>
          <input
            type="range" className="es-showtime__vol" min={0} max={100} step={5} value={muted ? 0 : volume}
            onChange={(e) => changeVolume(Number(e.target.value))} aria-label="Music volume"
          />
          <span className="es-showtime__now" aria-live="polite">
            {!muted && <span className="es-showtime__eq" aria-hidden="true"><i /><i /><i /></span>}
            <span className="fx-truncate">{name}</span>
          </span>
        </>
      )}
    </div>
  );
}

function Speaker({ muted }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4z" />
      {muted
        ? <><path d="m22 9-6 6" /><path d="m16 9 6 6" /></>
        : <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>}
    </svg>
  );
}
