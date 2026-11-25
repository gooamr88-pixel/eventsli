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

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

/** One second of white noise, shared by every hat, brush and clap. */
function noiseBuffer(ctx, seconds = 1, brown = false) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i += 1) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    } else {
      d[i] = white;
    }
  }
  return buf;
}

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

/**
 * The instruments. Each schedules one note at time `t` and cleans up after
 * itself; a stopped node is disconnected, so a long Showtime does not grow.
 */
function makeKit(ctx, out) {
  const noise = noiseBuffer(ctx, 1);
  const done = (node, ...rest) => { node.onended = () => { node.disconnect(); rest.forEach((n) => n.disconnect()); }; };

  const envelope = (t, peak, attack, decay) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(out);
    return g;
  };

  const noiseHit = (t, v, decay, type, freq, q = 0.7) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = envelope(t, v, 0.002, decay);
    src.connect(f).connect(g);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
    done(src, f, g);
  };

  return {
    kick(t, v = 0.9) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
      const g = envelope(t, v, 0.004, 0.4);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.46);
      done(o, g);
    },
    hat(t, v = 0.15, decay = 0.05) { noiseHit(t, v, decay, 'highpass', 7500); },
    shaker(t, v = 0.05) { noiseHit(t, v, 0.045, 'highpass', 5200); },
    clap(t, v = 0.25) { noiseHit(t, v, 0.18, 'bandpass', 1500, 0.8); },
    brush(t, v = 0.1) { noiseHit(t, v, 0.24, 'bandpass', 2800, 0.5); },
    bass(m, t, dur, v = 0.3) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = mtof(m);
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = mtof(m);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 420;
      const g = envelope(t, v, 0.01, dur);
      o.connect(f);
      sub.connect(f);
      f.connect(g);
      o.start(t); sub.start(t);
      o.stop(t + dur + 0.05); sub.stop(t + dur + 0.05);
      done(o, sub, f, g);
    },
    pad(notes, t, dur, v = 0.05, attack = 0.5) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(700, t);
      f.frequency.linearRampToValueAtTime(1500, t + dur * 0.5);
      f.frequency.linearRampToValueAtTime(800, t + dur);
      f.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v, t + attack);
      g.gain.setValueAtTime(v, t + Math.max(attack, dur - 0.6));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.9);
      f.connect(g).connect(out);
      const oscs = [];
      for (const m of notes) {
        for (const detune of [-8, 8]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(m);
          o.detune.value = detune;
          o.connect(f);
          o.start(t);
          o.stop(t + dur + 1);
          oscs.push(o);
        }
      }
      oscs[oscs.length - 1].onended = () => { oscs.forEach((o) => o.disconnect()); f.disconnect(); g.disconnect(); };
    },
    keys(notes, t, dur, v = 0.08) {
      for (const m of notes) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = mtof(m);
        const bell = ctx.createOscillator();
        bell.type = 'triangle';
        bell.frequency.value = mtof(m + 12);
        const bg = ctx.createGain();
        bg.gain.value = 0.18;
        const g = envelope(t, v / notes.length * 2, 0.006, dur);
        o.connect(g);
        bell.connect(bg).connect(g);
        o.start(t); bell.start(t);
        o.stop(t + dur + 0.05); bell.stop(t + dur + 0.05);
        done(o, bell, bg, g);
      }
    },
    pluck(m, t, v = 0.08) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = mtof(m);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(2600, t);
      f.frequency.exponentialRampToValueAtTime(500, t + 0.35);
      const g = envelope(t, v, 0.003, 0.42);
      o.connect(f).connect(g);
      o.start(t);
      o.stop(t + 0.5);
      done(o, f, g);
    },
    boom(t, v = 0.55) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(72, t);
      o.frequency.exponentialRampToValueAtTime(36, t + 0.7);
      const g = envelope(t, v, 0.01, 1.7);
      o.connect(g);
      o.start(t);
      o.stop(t + 1.8);
      done(o, g);
      noiseHit(t, v * 0.25, 0.3, 'lowpass', 220);
    },
    shimmer(m, t, v = 0.035) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = mtof(m);
      const g = envelope(t, v, 0.25, 2.6);
      o.connect(g);
      o.start(t);
      o.stop(t + 2.9);
      done(o, g);
    },
  };
}

/**
 * THE FOUR LOOPS: four bars of sixteenths each. `play(step, t, kit, spb)` is
 * called once per sixteenth, a little ahead of time; `step` counts from 0 for
 * ever. Exported for the test, which plays them into a recording kit.
 */
export const PATTERNS = Object.freeze({
  // A minor, 118 BPM: four on the floor, off-beat hats, a syncopated bass.
  arena: {
    bpm: 118,
    chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],
    roots: [33, 29, 36, 31],
    play(step, t, kit, spb) {
      const bar = Math.floor(step / 16) % 4;
      const s = step % 16;
      const ch = this.chords[bar];
      if (s % 4 === 0) kit.kick(t, 0.85);
      if (s % 4 === 2) kit.hat(t, 0.16, 0.07);
      else if (s % 2 === 1) kit.hat(t, 0.06, 0.03);
      if (s === 4 || s === 12) kit.clap(t, 0.2);
      if ([0, 3, 6, 8, 11, 14].includes(s)) kit.bass(this.roots[bar], t, spb * 1.6, 0.3);
      if (s === 0) kit.pad(ch, t, spb * 16, 0.045, 0.35);
      if (s % 2 === 0) kit.pluck(ch[(s / 2) % 3] + 12, t, 0.045);
    },
  },
  // ii–V–I in C, 84 BPM: warm keys, brushes on two and four, a walking bass.
  lounge: {
    bpm: 84,
    chords: [[53, 57, 60, 64], [53, 59, 64], [52, 55, 59, 62], [55, 61, 64]],
    roots: [38, 43, 36, 45],
    play(step, t, kit, spb) {
      const bar = Math.floor(step / 16) % 4;
      const s = step % 16;
      const ch = this.chords[bar];
      const root = this.roots[bar];
      if (s === 0) kit.keys(ch, t, spb * 7, 0.09);
      if (s === 7) kit.keys(ch, t, spb * 3, 0.06);
      if (s === 10) kit.keys(ch, t, spb * 5, 0.05);
      if (s === 4 || s === 12) kit.brush(t, 0.09);
      if (s % 4 === 2) kit.hat(t, 0.04, 0.05);
      if (s % 4 === 0) kit.bass([root, root + 7, root + 12, root + 10][s / 4], t, spb * 3.6, 0.26);
      if (s === 0) kit.kick(t, 0.3);
      if (s === 10) kit.kick(t, 0.18);
    },
  },
  // C minor, 70 BPM: long swells, a deep drum on the ones, light above.
  cinematic: {
    bpm: 70,
    chords: [[48, 55, 63], [44, 51, 60], [51, 55, 58], [46, 53, 58]],
    drone: 36,
    play(step, t, kit, spb) {
      const bar = Math.floor(step / 16) % 4;
      const s = step % 16;
      const ch = this.chords[bar];
      if (s === 0) {
        kit.pad(ch, t, spb * 16, 0.06, 1.4);
        kit.pad(ch.map((m) => m + 12), t, spb * 16, 0.02, 2);
      }
      if (s === 0 && bar % 2 === 0) kit.boom(t, 0.55);
      if (s === 12 && bar === 3) kit.boom(t, 0.4);
      if (s === 0 || s === 6 || s === 10) kit.shimmer(ch[(step >> 1) % ch.length] + 24, t, 0.03);
      if (s % 2 === 0) kit.hat(t, 0.02, 0.03);
    },
  },
  // F major, 96 BPM: an arpeggio of plucks, a soft kick, a shaker.
  chill: {
    bpm: 96,
    chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]],
    roots: [41, 40, 38, 36],
    arp: [0, 2, 1, 3, 2, 1, 3, 2],
    play(step, t, kit, spb) {
      const bar = Math.floor(step / 16) % 4;
      const s = step % 16;
      const ch = this.chords[bar];
      if (s === 0) kit.pad(ch, t, spb * 16, 0.03, 0.6);
      if (s % 2 === 0) kit.pluck(ch[this.arp[s / 2]] + 12, t, 0.075);
      if (s === 0 || s === 8) kit.kick(t, 0.55);
      kit.shaker(t, s % 4 === 2 ? 0.055 : 0.025);
      if (s === 4 || s === 12) kit.clap(t, 0.09);
      if (s === 0 || s === 6 || s === 8) kit.bass(this.roots[bar], t, spb * 2, 0.26);
    },
  },
});

function startLoop(ctx, out, preset) {
  const pattern = PATTERNS[preset] || PATTERNS.arena;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.ratio.value = 3;
  glue.attack.value = 0.01;
  glue.release.value = 0.2;
  glue.connect(out);
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
  if (!sound || sound.kind === 'off' || typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const volume = Math.max(0, Math.min(1, sound.volume ?? 0.7)) * 0.85;

  const master = ctx.createGain();
  master.gain.value = 0.0001;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
  master.connect(analyser);

  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = Math.max(6, roomRadius * 0.35);
  panner.rolloffFactor = 0.9;
  panner.maxDistance = 2000;
  master.connect(panner).connect(ctx.destination);

  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, Math.min(4, Math.max(1.2, 1.1 + roomRadius / 30)));
  const wet = ctx.createGain();
  wet.gain.value = 0.2;
  master.connect(verb).connect(wet).connect(ctx.destination);

  let stopLoop = null;
  let el = null;
  let muted = false;
  let on = false;
  let name = sound.name || '';

  const playLoop = (preset) => { stopLoop = startLoop(ctx, master, preset); };

  if (sound.kind === 'track' && sound.url) {
    el = new Audio();
    el.crossOrigin = 'anonymous';
    el.loop = true;
    el.preload = 'auto';
    el.src = sound.url;
    const src = ctx.createMediaElementSource(el);
    src.connect(master);
    const fail = () => {
      if (!el) return;
      el.pause();
      el = null;
      name = 'Arena · Eventsli music';
      playLoop('arena');
      onTrackFailed?.();
    };
    el.addEventListener('error', fail, { once: true });
    el.play().catch(fail);
  } else {
    playLoop(sound.preset);
  }

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

    /** In from silence over a second: a show starts, it does not switch on. */
    start() {
      on = true;
      ctx.resume?.();
      el?.play?.().catch(() => {});
      setGain(muted ? 0.0001 : volume, 1.2);
    },
    stop() {
      on = false;
      setGain(0.0001, 0.6);
      setTimeout(() => { if (!on) { el?.pause?.(); ctx.suspend?.(); } }, 700);
    },
    setMuted(m) {
      muted = Boolean(m);
      if (on) setGain(muted ? 0.0001 : volume, 0.25);
    },
    /** Pause with the page: a hidden tab plays nothing. */
    pause() { ctx.suspend?.(); el?.pause?.(); },
    resume() { if (on) { ctx.resume?.(); el?.play?.().catch(() => {}); } },

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
      on = false;
      stopLoop?.();
      if (el) { el.pause(); el.src = ''; el = null; }
      ctx.close?.().catch?.(() => {});
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
