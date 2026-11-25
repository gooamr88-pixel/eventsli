/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The stage screen's VIDEOS: the elements screenPainter draws from, and how
 * they are kept playing (2026-11-25).
 *
 * STEADY PLAYBACK (owner: "the video is not stable — work then not work then
 * work"). Three things made it flicker, and each has its rule here:
 *   • A video element outside the page counts as off screen, and Chrome
 *     pauses a muted video nobody can see — then the next frame played it
 *     again. Every video lives IN the page, in a 1px box no one sees.
 *   • A video that is buffering or seeking has no frame; drawing it flashed
 *     the background. The last good frame is kept and drawn instead.
 *   • play() was called again on every frame while the first call was still
 *     starting. It is called once, and retried a second after a refusal.
 *
 * A video does not loop (the running order moves on when it ends) unless it
 * is the whole show. It is muted here; its sound, in Showtime, is
 * stageSound.js's to switch on (`audible` says which video that is).
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MAX_VIDEO_MS = 5 * 60 * 1000;

export function createVideoShelf({ onAsset = null } = {}) {
  const videos = new Map();
  const onScreen = new Set();
  let audible = null;
  let holder = null;

  const hold = (v) => {
    if (typeof document === 'undefined' || !document.body) return;
    if (!holder) {
      holder = document.createElement('div');
      holder.setAttribute('aria-hidden', 'true');
      holder.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
      document.body.appendChild(holder);
    }
    v.style.cssText = 'width:1px;height:1px';
    holder.appendChild(v);
  };

  const entryOf = (slide) => (slide?.kind === 'video' ? videos.get(slide.video?.url) : null);

  const drop = (e) => {
    e.v.pause?.();
    e.v.removeAttribute('src');
    e.v.load?.();
    e.v.remove();
  };

  return {
    /**
     * The video at `url` with a frame to draw, else its last good frame,
     * else null (and it is fetched). `sound`: this is the slide whose sound
     * belongs on the stage.
     */
    vid(url, { sound = false } = {}) {
      if (!url) return null;
      let e = videos.get(url);
      if (!e) {
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.muted = true;
        v.loop = false;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.preload = 'auto';
        e = { v, ok: false, failed: false, pending: false, retryAt: 0, last: null, snapAt: 0 };
        v.addEventListener('loadeddata', () => { e.ok = true; onAsset?.(); });
        v.addEventListener('error', () => { e.failed = true; });
        v.src = url;
        hold(v);
        videos.set(url, e);
      }
      onScreen.add(e);
      audible = sound && e.ok ? e.v : null;
      if (e.ok && e.v.readyState >= 2 && e.v.videoWidth) {
        const t = performance.now();
        if (t - e.snapAt > 400) {
          e.snapAt = t;
          if (!e.last) e.last = document.createElement('canvas');
          e.last.width = 640;
          e.last.height = Math.max(1, Math.round((640 * e.v.videoHeight) / e.v.videoWidth));
          try { e.last.getContext('2d')?.drawImage(e.v, 0, 0, e.last.width, e.last.height); } catch { e.last = null; }
        }
        return e.v;
      }
      return e.last;
    },

    /** How long a slide holds the screen: a video's whole clip, else `slot`. */
    lengthOf(slide, slot) {
      if (slide?.kind !== 'video') return slot;
      const e = entryOf(slide);
      if (!e || e.failed) return slot;
      const d = e.v.duration;
      if (Number.isFinite(d) && d > 0) return Math.min(MAX_VIDEO_MS, d * 1000 + 1500);
      // Still on its way: wait a while for it rather than skip it.
      return slot * 2;
    },

    /** The slide's video has played to its end. */
    ended(slide) {
      const e = entryOf(slide);
      return Boolean(e?.ok && e.v.ended);
    },

    /** From the top: each time a video's slide comes on, it plays in full. */
    rewind(slide) {
      const e = entryOf(slide);
      if (!e) return;
      try { e.v.currentTime = 0; } catch { /* not seekable yet: it starts at 0 anyway */ }
    },

    /** Before a frame: nothing is on screen until the slides say so. */
    beginFrame() {
      onScreen.clear();
      audible = null;
    },

    /** After a frame: play what it showed (looping only a show of one), pause the rest. */
    endFrame(now, loop) {
      for (const e of videos.values()) {
        if (!onScreen.has(e)) {
          if (!e.v.paused) e.v.pause?.();
          continue;
        }
        e.v.loop = loop;
        if (!e.v.paused || e.pending || e.v.ended || now < e.retryAt) continue;
        const p = e.v.play?.();
        if (!p?.then) continue;
        e.pending = true;
        p.then(() => { e.pending = false; }, () => { e.pending = false; e.retryAt = now + 1000; });
      }
    },

    /** A video is on the screen: repaint at full rate. */
    get moving() { return onScreen.size > 0; },
    /** The element whose sound belongs on the stage now, or null. */
    get audible() { return audible; },

    /**
     * New elements for every video: an element can join one audio graph,
     * once, so after the soundtrack engine is replaced the old ones could
     * no longer be heard.
     */
    reset() {
      for (const e of videos.values()) drop(e);
      videos.clear();
    },

    dispose() {
      for (const e of videos.values()) drop(e);
      videos.clear();
      holder?.remove();
      holder = null;
    },
  };
}

/**
 * THE RUNNING ORDER. Not a fixed grid of equal slots: each slide holds the
 * screen for its own length (`lengthOf`), so a video plays start to finish
 * instead of in pieces between other slides, then the show moves on.
 */
export function createRunningOrder({ lengthOf, ended, rewind }) {
  const show = { id: null, index: 0, start: null, prev: null, prevAt: -Infinity };

  const advance = (list, i, now) => {
    const next = (i + 1) % list.length;
    show.prev = list[i];
    show.prevAt = now;
    show.index = next;
    show.id = list[next].id;
    show.start = now;
    rewind(list[next]);
  };

  return {
    show,
    advance,
    /** Which slide is on now, moving the show along when one has had its time. */
    place(list, now) {
      if (show.start === null) {
        show.start = now;
        show.index = 0;
        show.id = list[0].id;
        rewind(list[0]);
      }
      let i = list.findIndex((x) => x.id === show.id);
      if (i < 0) {
        // The slide on screen left the list (an edit, a countdown that ended).
        i = Math.min(show.index, list.length - 1);
        show.id = list[i].id;
        show.start = now;
        rewind(list[i]);
      }
      show.index = i;
      if (list.length > 1 && (ended(list[i]) || now - show.start >= lengthOf(list[i]))) {
        advance(list, i, now);
        i = show.index;
      }
      return i;
    },
  };
}
