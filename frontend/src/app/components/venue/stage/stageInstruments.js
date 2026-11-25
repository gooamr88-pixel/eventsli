/**
 * The instruments Eventsli music is played on (stageSound.js schedules them;
 * stageLoops.js says what to play). Oscillators and filtered noise only.
 */
export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

/** One second of white noise, shared by every hat, brush and clap. */
export function noiseBuffer(ctx, seconds = 1, brown = false) {
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

/**
 * The instruments. Each schedules one note at time `t` and cleans up after
 * itself; a stopped node is disconnected, so a long Showtime does not grow.
 */
export function makeKit(ctx, out) {
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
