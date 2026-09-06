/**
 * Sound and haptics at the door, synthesised — no audio files.
 *
 * Ported from fancy's `utils/sound.js`, with one thing changed: there are THREE
 * signals here, not two. A queued scan is not a success and not a refusal, and
 * playing it the "accept" chime would tell an operator holding a tablet at
 * arm's length that somebody was admitted when nothing was decided at all.
 *
 * Every call is best-effort. A browser that blocks audio (no prior gesture, no
 * Web Audio) produces silence, never an error — the screen is the record, the
 * sound is only so the operator does not have to look at it between guests.
 *
 * ONE AudioContext, unlocked by the first user gesture (the "start scanning"
 * tap) and reused for every later tone, because the CONTEXT is what browsers
 * gate, not each individual play.
 */

let ctx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(context, { freq, start, duration, type = 'sine', peak = 0.09 }) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(context.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function play(notes) {
  const c = getCtx();
  if (!c) return;
  try {
    const t = c.currentTime;
    for (const n of notes) tone(c, { ...n, start: t + n.at });
  } catch { /* silent */ }
}

function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported — fine */ }
}

/** Rising two notes. Let them in. */
export function signalAdmit() {
  play([
    { freq: 660, at: 0, duration: 0.13, type: 'triangle', peak: 0.08 },
    { freq: 988, at: 0.075, duration: 0.18, type: 'triangle', peak: 0.09 },
  ]);
  buzz([12, 24, 12]);
}

/** Falling two notes — the mirror image, so a refusal is audibly a different
 *  KIND of sound rather than a variation on the same positive one. */
export function signalRefuse() {
  play([
    { freq: 392, at: 0, duration: 0.16, type: 'sawtooth', peak: 0.07 },
    { freq: 262, at: 0.1, duration: 0.24, type: 'sawtooth', peak: 0.07 },
  ]);
  buzz([50, 40, 50]);
}

/** One flat note. Something is recorded; nothing is decided. */
export function signalHold() {
  play([{ freq: 494, at: 0, duration: 0.12, type: 'sine', peak: 0.06 }]);
  buzz(25);
}

/** Routes a tone from the outcome's tone, so a new outcome cannot be added with
 *  a colour and no sound. */
export function signalFor(tone_) {
  if (tone_ === 'admit') return signalAdmit();
  if (tone_ === 'hold') return signalHold();
  return signalRefuse();
}

/** Unlocks the audio context from inside a real user gesture. Called on the tap
 *  that starts the camera, so the first scan's chime is not the one that gets
 *  swallowed. */
export function primeAudio() {
  getCtx();
}
