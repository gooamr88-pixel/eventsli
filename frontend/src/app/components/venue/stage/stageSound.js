import { PATTERNS } from './stageLoops';
import { sharedAudio } from './audioUnlock';
import { mtof, noiseBuffer, makeKit } from './stageInstruments';
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SOUNDTRACK of the 3D room's Showtime (2026-11-25).
 *
 * Two sources, one graph:
 *
 *   • EVENTSLI MUSIC — four short loops (Arena, Lounge, Cinematic, Chill)
 *     PLAYED, not recorded: oscillators and filtered noise scheduled a beat
 *     ahead. Nothing to license, nothing to download, and it is the same on
 *     every map.
 *   • THE ORGANIZER'S TRACK — an MP3 or M4A they uploaded, looped.
 *
 *   source ─► master ─┬─► analyser               (what the screen and the lights read)
 *                     ├─► panner ─► speakers     (the stage, in the room)
 *                     └─► reverb ─► speakers     (the room itself)
 *
 * IT COMES FROM THE STAGE. The panner sits on the screen and the listener on
 * the camera, so the music is in front of a buyer looking at the stage and
 * behind one who turns round, and a seat at the back hears less of the band
 * and more of the room — the reverb is not distance-faded and the dry sound
 * is. The reverb's length follows the room's size.
 *
 * NEVER STARTS BY ITSELF. `createStageSound` must be called from a tap (a
 * browser plays nothing otherwise, and a seat map that blared on opening
 * would be worse than silent). It is browser-only and is never imported on
 * the server.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A room's tail: decaying stereo noise, longer for a larger room. */
function impulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c += 1) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
  }
  return buf;
}

// The four loops live in stageLoops.js; re-exported for the tests.
export { PATTERNS } from './stageLoops';

function startLoop(ctx, out, preset) {
  const pattern = PATTERNS[preset] || PATTERNS.arena;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.ratio.value = 3;
  glue.attack.value = 0.01;
  glue.release.value = 0.2;
  // Make-up gain: the loops are built from quiet voices so they never clip
  // each other; this brings the mix to a track's level (2026-11-25: "the
  // sound is very low"). The limiter after the master catches the peaks.
  const makeup = ctx.createGain();
  makeup.gain.value = 3.2;
  glue.connect(makeup).connect(out);
  const kit = makeKit(ctx, glue);
  const spb = 60 / pattern.bpm / 4;
  let step = 0;
  let next = ctx.currentTime + 0.08;
  const extra = [];

  // The room under the music: a low murmur, like a crowd before the lights.
  const murmur = ctx.createBufferSource();
  murmur.buffer = noiseBuffer(ctx, 3, true);
  murmur.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 380;
  band.Q.value = 0.5;
  const mg = ctx.createGain();
  mg.gain.value = 0.05;
  murmur.connect(band).connect(mg).connect(out);
  murmur.start();
  extra.push(murmur, band, mg);

  if (pattern.drone) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(pattern.drone);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 170;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    o.connect(f).connect(g).connect(glue);
    o.start();
    extra.push(o, f, g);
  }

  // A look-ahead scheduler: notes are placed on the audio clock a beat early,
  // so a busy main thread delays the next look, never a note.
  const timer = setInterval(() => {
    while (next < ctx.currentTime + 0.14) {
      try { pattern.play(step, next, kit, spb); } catch { /* one bad note is not worth the show */ }
      next += spb;
      step += 1;
    }
  }, 25);

  return () => {
    clearInterval(timer);
    for (const n of extra) {
      try { n.stop?.(); } catch { /* already stopped */ }
      n.disconnect();
    }
    glue.disconnect();
    makeup.disconnect();
  };
}

/**
 * @param {object} p
 * @param {{kind:'preset'|'track', preset?:string, url?:string, volume?:number}} p.sound  screenModel.soundFor
 * @param {number} p.roomRadius   metres, for the reverb's length and how far the sound carries
 * @param {Function} [p.onTrackFailed]  the organizer's track would not play (the loop plays instead)
 * @returns the engine, or null where the browser has no Web Audio
 */
export function createStageSound({ sound, roomRadius = 20, onTrackFailed = null }) {
  // 'off' still gets an engine: no music, but a video slide's own sound
  // plays through it (2026-11-25, "the sound of the video does not work").
  if (!sound || typeof window === 'undefined') return null;
  // The page's one context, unlocked by the tap that opened the 3D view
  // (audioUnlock.js). Never closed here: other soundtracks reuse it.
  const ctx = sharedAudio();
  if (!ctx) return null;
  // Full volume is a little over unity: the limiter below keeps it clean.
  const level = (v) => Math.max(0, Math.min(1, v)) * 1.3;
  let volume = level(sound.volume ?? 0.8);

  const master = ctx.createGain();
  master.gain.value = 0.0001;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
  master.connect(analyser);

  // A brick-wall limiter in front of the speakers: loud, never distorted.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  limiter.connect(ctx.destination);

  // Direction from the stage, and only a GENTLE fall-off with distance: the
  // overview camera sits far back, and a show heard from there was too quiet.
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = Math.max(14, roomRadius * 0.9);
  panner.rolloffFactor = 0.45;
  panner.maxDistance = 2000;
  master.connect(panner).connect(limiter);

  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, Math.min(4, Math.max(1.2, 1.1 + roomRadius / 30)));
  const wet = ctx.createGain();
  wet.gain.value = 0.2;
  master.connect(verb).connect(wet).connect(limiter);

  let stopLoop = null;
  let el = null;
  let muted = false;
  let on = false;
  let name = sound.kind === 'off' ? null : sound.name || '';

  // THE MUSIC AND THE VIDEOS ARE TWO BUSES into the master, so the music can
  // dip under a video's own sound (ducking) and come back after it.
  const musicBus = ctx.createGain();
  musicBus.connect(master);
  const videoBus = ctx.createGain();
  videoBus.connect(master);
  // A media element can be routed into one audio graph, once: its source node
  // is kept for as long as this engine lives.
  const videoSources = new WeakMap();
  let video = null;

  // Sources run only while Showtime is on: started by `start`, stopped by
  // `stop` (the context itself keeps running, see audioUnlock.js).
  let preset = sound.kind === 'preset' ? sound.preset : null;
  // The browser refused to play the track without a tap: not a failure, the
  // next tap plays it (`unlock`).
  let trackBlocked = false;
  const playLoop = () => { if (preset && !stopLoop) stopLoop = startLoop(ctx, musicBus, preset); };
  const halt = () => {
    stopLoop?.();
    stopLoop = null;
    el?.pause?.();
  };

  const fail = () => {
    if (!el) return;
    el.pause();
    el = null;
    name = 'Arena · Eventsli music';
    preset = 'arena';
    if (on) playLoop();
    onTrackFailed?.();
  };
  const playTrack = () => el?.play?.()?.then?.(
    () => { trackBlocked = false; },
    (err) => { if (err?.name === 'NotAllowedError') trackBlocked = true; else fail(); },
  );
  if (sound.kind === 'track' && sound.url) {
    el = new Audio();
    el.crossOrigin = 'anonymous';
    el.loop = true;
    el.preload = 'auto';
    el.src = sound.url;
    const src = ctx.createMediaElementSource(el);
    src.connect(musicBus);
    el.addEventListener('error', fail, { once: true });
  }

  const duck = (down) => {
    musicBus.gain.setTargetAtTime(down ? 0.15 : 1, ctx.currentTime, 0.3);
  };
  /**
   * The video on the screen now (an element the painter plays), or null. Its
   * sound comes from the stage like the music's, while Showtime is on; the
   * element is muted again the moment it leaves the screen or Showtime ends.
   */
  const setVideo = (next) => {
    const target = on ? next || null : null;
    if (target === video) return;
    if (video) video.muted = true;
    video = null;
    if (target) {
      try {
        if (!videoSources.has(target)) {
          const src = ctx.createMediaElementSource(target);
          src.connect(videoBus);
          videoSources.set(target, src);
        }
        target.muted = false;
        target.volume = 1;
        // Unmuting may pause a video on a strict browser: try to keep it going,
        // and fall back to silent rather than frozen.
        target.play?.()?.catch?.(() => { target.muted = true; target.play?.()?.catch?.(() => {}); });
        video = target;
      } catch {
        video = null;
      }
    }
    duck(Boolean(video));
  };

  const bins = new Uint8Array(analyser.frequencyBinCount);
  const setGain = (to, seconds) => {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
    master.gain.exponentialRampToValueAtTime(Math.max(0.0001, to), now + seconds);
  };

  const param = (p, v) => { if (p) p.setTargetAtTime(v, ctx.currentTime, 0.05); };

  return {
    get name() { return name; },
    get playing() { return on; },
    /** Showtime has music of its own (not 'off'). */
    get hasMusic() { return sound.kind !== 'off'; },
    video: setVideo,

    /**
     * In from silence over a second: a show starts, it does not switch on.
     * Resolves once the browser has said whether sound may play (`blocked`).
     */
    start() {
      on = true;
      playLoop();
      playTrack();
      setGain(muted ? 0.0001 : volume, 1.2);
      return Promise.resolve(ctx.state === 'running' ? null : ctx.resume?.()).catch(() => {});
    },
    stop() {
      on = false;
      setVideo(null);
      setGain(0.0001, 0.6);
      setTimeout(() => { if (!on) halt(); }, 700);
    },
    /** The browser is holding the sound back until a tap. */
    get blocked() { return on && (ctx.state !== 'running' || trackBlocked); },
    /** Call inside a tap: lets held-back sound play. */
    unlock() {
      const waits = [Promise.resolve(ctx.resume?.()).catch(() => {})];
      if (el && on) waits.push(Promise.resolve(playTrack()));
      if (video) video.play?.()?.catch?.(() => {});
      return Promise.all(waits);
    },
    /** The buyer's own volume, 0–1, on top of the organizer's. */
    setVolume(v) {
      volume = level(v);
      if (on && !muted) setGain(Math.max(0.0001, volume), 0.15);
    },
    setMuted(m) {
      muted = Boolean(m);
      if (on) setGain(muted ? 0.0001 : volume, 0.25);
    },
    /** Pause with the page: a hidden tab plays nothing. */
    pause() { halt(); },
    resume() { if (on) { playLoop(); playTrack(); } },

    /** Where the music comes from: the screen. */
    place(x, y, z) {
      if (panner.positionX) { param(panner.positionX, x); param(panner.positionY, y); param(panner.positionZ, z); } else panner.setPosition(x, y, z);
    },
    /** Where the listener is and which way they face: the camera. */
    listen(pos, fwd, up) {
      const l = ctx.listener;
      if (l.positionX) {
        param(l.positionX, pos.x); param(l.positionY, pos.y); param(l.positionZ, pos.z);
        param(l.forwardX, fwd.x); param(l.forwardY, fwd.y); param(l.forwardZ, fwd.z);
        param(l.upX, up.x); param(l.upY, up.y); param(l.upZ, up.z);
      } else {
        l.setPosition?.(pos.x, pos.y, pos.z);
        l.setOrientation?.(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
      }
    },
    /** The music now: overall level and bass, 0–1, and the spectrum. */
    read() {
      analyser.getByteFrequencyData(bins);
      let all = 0;
      let low = 0;
      for (let i = 0; i < bins.length; i += 1) { all += bins[i]; if (i < 5) low += bins[i]; }
      return { level: all / bins.length / 255, bass: Math.max(0, (low / 5 / 255 - 0.3) / 0.7), bins };
    },
    dispose() {
      if (video) video.muted = true;
      video = null;
      on = false;
      halt();
      if (el) { el.src = ''; el = null; }
      // The context is the page's: only this soundtrack's nodes go.
      for (const n of [master, musicBus, videoBus, analyser, panner, verb, wet, limiter]) {
        try { n.disconnect(); } catch { /* already */ }
      }
    },
  };
}

/**
 * A beat with no music: Showtime with the sound off (or not yet started)
 * still breathes at 120 BPM, so the lights never sit dead.
 */
export function idleBeat(seconds) {
  const phase = (seconds * 2) % 1;
  const bass = Math.exp(-phase * 6);
  return { level: 0.35 + 0.15 * Math.sin(seconds * 1.3), bass, bins: null };
}
