/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE AUDIO CONTEXT FOR THE PAGE, UNLOCKED BY A TAP (2026-11-25, owner:
 * "make it play auto").
 *
 * Showtime now starts by itself when the 3D view opens. Browsers let a page
 * make sound only after a tap, and an iPhone only for an audio context that
 * was started INSIDE one. The tap that opens the 3D view is that tap, but the
 * room (and its soundtrack) is ready a moment later, outside it. So the tap
 * calls `primeAudio()`: the page's one context is made and started there, and
 * the soundtrack picks it up when it is ready (`sharedAudio()`).
 *
 * The context is never closed or suspended once running: a context an iPhone
 * unlocked may refuse to start again without another tap. Soundtracks stop
 * their own sources instead (stageSound.js).
 * ─────────────────────────────────────────────────────────────────────────────
 */
let shared = null;

/** The page's audio context, made on first use; null without Web Audio. */
export function sharedAudio() {
  if (typeof window === 'undefined') return null;
  if (shared && shared.state !== 'closed') return shared;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { shared = new AC(); } catch { shared = null; }
  return shared;
}

/**
 * Call from inside a tap (the 3D or 360° switch, "Tap for sound"). Starts
 * the context and plays one silent sample, which is what unlocks iOS.
 */
export function primeAudio() {
  const ctx = sharedAudio();
  if (!ctx) return;
  try {
    if (ctx.state !== 'running') ctx.resume?.()?.catch?.(() => {});
    const buffer = ctx.createBuffer(1, 1, 22050);
    const blip = ctx.createBufferSource();
    blip.buffer = buffer;
    blip.connect(ctx.destination);
    blip.start(0);
  } catch { /* nothing to unlock on this browser */ }
}

/** For tests: forget the page's context. */
export function forgetSharedAudio() { shared = null; }
