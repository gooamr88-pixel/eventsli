'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The camera.
 *
 * `Html5Qrcode` — the bare engine — and not `Html5QrcodeScanner`, its stock
 * widget. The widget opens on its own "camera or file? grant permission?"
 * chooser, which is a reasonable default for a page that might want either and
 * is nonsense on a tablet bolted to a door that only ever wants the back
 * camera. The engine asks for the camera immediately and leaves the UI to us.
 * (Same reasoning as fancy's check-in kiosk, which learned it the hard way.)
 *
 * Imported dynamically, so the 300KB decoder is not in the bundle of a
 * storefront that will never scan anything.
 *
 * THE COOLDOWN IS THE INTERESTING PART. The decoder fires its callback on every
 * frame it can read — ten times a second while a code sits in front of the
 * lens. Passing each of those on would queue ten scans for one guest. So an
 * identical code is ignored for a few seconds, and a DIFFERENT code is accepted
 * instantly: at a busy gate people present tickets back to back, and a global
 * "one scan per 3s" throttle would be a queue.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DECODE_CONFIG = { fps: 10, qrbox: { width: 260, height: 260 } };

export const READER_ID = 'gate-reader';

export function useScanner({ active, onDecode, cooldownMs = 3000 }) {
  const [status, setStatus] = useState('idle');   // idle | starting | running | error
  const [error, setError] = useState(null);
  const [torch, setTorch] = useState({ available: false, on: false });

  const instanceRef = useRef(null);
  const lastRef = useRef({ text: null, at: 0 });

  /**
   * The callback, held in a ref rather than named in the dependency array.
   *
   * `onDecode` closes over the queue and the session, so its identity changes
   * after every single scan. In the dependency array that tears the camera down
   * and builds it up again between guests — a black rectangle and a fresh
   * permission check on a device that is meant to run for four hours. The ref
   * keeps the effect's dependencies to the one thing that should actually
   * restart a camera: whether it is meant to be on.
   */
  const onDecodeRef = useRef(onDecode);
  useEffect(() => { onDecodeRef.current = onDecode; });

  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    let instance = null;

    const handle = (text) => {
      const now = Date.now();
      const last = lastRef.current;
      if (text === last.text && now - last.at < cooldownMs) return;
      lastRef.current = { text, at: now };
      onDecodeRef.current?.(text);
    };

    (async () => {
      setStatus('starting');
      setError(null);
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;

        instance = new Html5Qrcode(READER_ID, { verbose: false });
        instanceRef.current = instance;

        try {
          // The rear camera is what a door wants, and asking for it by facing
          // mode is also what triggers the browser's native permission prompt
          // directly on the first attempt.
          await instance.start({ facingMode: 'environment' }, DECODE_CONFIG, handle, () => {});
        } catch {
          if (cancelled) return;
          // No environment-facing camera — a laptop with one webcam, which is
          // what a developer testing this has.
          const cameras = await Html5Qrcode.getCameras();
          if (!cameras?.length) throw new Error('NO_CAMERA');
          await instance.start(cameras[cameras.length - 1].id, DECODE_CONFIG, handle, () => {});
        }

        if (cancelled) return;
        setStatus('running');

        // Best-effort, and genuinely useful: a lot of doors are dark and a lot
        // of tickets are on a cracked phone screen.
        try {
          const caps = instance.getRunningTrackCapabilities?.() || {};
          if (caps.torch) setTorch({ available: true, on: false });
        } catch { /* not exposed on this browser */ }
      } catch (err) {
        if (cancelled) return;
        const message = String(err?.message || err || '');
        setStatus('error');
        setError(
          /NO_CAMERA|NotFoundError|NotReadableError/i.test(message)
            ? 'No camera on this device, or another app is holding it. Type the code in instead.'
            : /NotAllowedError|Permission/i.test(message)
              ? 'Camera access was refused. Allow it for this site in the browser settings, then start again.'
              : 'The camera would not start. Type the code in instead.',
        );
      }
    })();

    return () => {
      cancelled = true;
      instanceRef.current = null;
      // stop() rejects if start() never resolved. Swallowed: there is nothing
      // to tell anyone about a camera that is already not running.
      if (instance) instance.stop().then(() => instance.clear()).catch(() => {});
    };
  }, [active, cooldownMs]);

  const toggleTorch = useCallback(async () => {
    const instance = instanceRef.current;
    if (!instance) return;
    const next = !torch.on;
    try {
      await instance.applyVideoConstraints({ advanced: [{ torch: next }] });
      setTorch((t) => ({ ...t, on: next }));
    } catch {
      setTorch((t) => ({ ...t, available: false }));
    }
  }, [torch.on]);

  /**
   * The screen must not sleep mid-shift.
   *
   * Best-effort and re-acquired on visibility change: the browser releases a
   * wake lock whenever the page is hidden, so one taken at the start of the
   * night is gone the first time somebody switches apps and never comes back.
   */
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.wakeLock) return undefined;

    let sentinel = null;
    let released = false;

    const acquire = () => {
      if (released || document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen')
        .then((s) => { if (released) s.release().catch(() => {}); else sentinel = s; })
        .catch(() => {});
    };

    acquire();
    document.addEventListener('visibilitychange', acquire);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', acquire);
      if (sentinel) sentinel.release().catch(() => {});
    };
  }, [active]);

  /**
   * `idle` is DERIVED from `active`, not written by an effect that watches it.
   *
   * The effect version — "when active goes false, setStatus('idle')" — renders
   * once with the stale status before the effect corrects it, which on this
   * screen is a camera error still on display for a frame after the camera was
   * switched off. React's own lint rule names the pattern, and the fix is the
   * one it recommends: if a value can be computed from props, compute it.
   */
  return {
    status: active ? status : 'idle',
    error: active ? error : null,
    torch,
    toggleTorch,
    readerId: READER_ID,
  };
}
