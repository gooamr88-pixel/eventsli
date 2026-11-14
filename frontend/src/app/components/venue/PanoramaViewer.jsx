'use client';

import { useEffect, useRef, useState } from 'react';
import ViewerProblem from './ViewerProblem';
import { direction } from './photoSpots';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A 360° photo, looked around from the inside.
 *
 * The image is an equirectangular panorama (2:1) — what every 360° camera and
 * phone panorama mode exports — mapped onto the inside of a sphere. Drag to
 * look, scroll or pinch to zoom; it turns slowly on its own until touched, so
 * a viewer who has never met a photo sphere sees at once that it moves.
 *
 * `heading` is where the view opens, in degrees, so an organizer can point a
 * seat's photo at the stage rather than at whatever the camera faced.
 *
 * `spots` are seats placed on the photo (photoSpots.projectSeats), drawn as
 * real buttons that follow the view: each frame projects its direction to the
 * screen. They are DOM, not WebGL, so they are focusable, labelled and hit-
 * tested by the browser. A drag that starts on a dot still turns the view;
 * only a tap presses it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function PanoramaViewer({
  url, heading = 0, className = '', label = '360° view', onFallback, spots = null, onSpot,
}) {
  const hostRef = useRef(null);
  const spotEls = useRef(new Map());
  const spotData = useRef([]);
  const dragged = useRef(false);
  const onSpotRef = useRef(onSpot);
  // Read once, when the viewer opens. A caller that wants a new heading to
  // re-open the view changes the `key` (the studio does, until the photo has
  // seats on it); otherwise turning the dial moves the dots over a still
  // photo, and never rebuilds the renderer or reloads the image.
  const headingRef = useRef(heading);
  useEffect(() => {
    spotData.current = (spots || []).map((s) => ({ id: s.id, d: direction(s.yaw, s.pitch), distance: s.distance }));
    onSpotRef.current = onSpot;
    headingRef.current = heading;
  }, [spots, onSpot, heading]);
  // 'loading' | 'ready', or a ViewerProblem kind: 'nogl' | 'load' | 'lost' | 'photo'.
  const [state, setState] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const retry = () => { setState('loading'); setAttempt((a) => a + 1); };

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    const host = hostRef.current;
    (async () => {
      let THREE;
      try {
        THREE = await import('three');
      } catch {
        if (!disposed) setState('load');   // the 3D code did not arrive
        return;
      }
      if (disposed || !host) return;
      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
      } catch {
        setState('nogl');
        return;
      }
      const coarse = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const el = renderer.domElement;
      el.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
      el.setAttribute('aria-hidden', 'true');
      host.appendChild(el);
      // A large photo on a phone can make iOS drop the GPU context; the
      // canvas would just go dark. Say so instead.
      el.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        if (disposed) return;   // our own cleanup forces a loss too
        renderer.setAnimationLoop(null);
        setState('lost');
      });

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200);
      const geometry = new THREE.SphereGeometry(50, 64, 40);
      geometry.scale(-1, 1, 1);
      const material = new THREE.MeshBasicMaterial({ color: 0x111111 });
      scene.add(new THREE.Mesh(geometry, material));

      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      loader.load(url, (tex) => {
        if (disposed) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        material.map = tex;
        material.color.set(0xffffff);
        material.needsUpdate = true;
        setState('ready');
      }, undefined, () => { if (!disposed) setState('photo'); });

      // A photo with seats on it holds still: a buyer aiming at a dot should
      // not have it drift away.
      // It opens tilted toward the seats: chairs sit below a standing camera,
      // and level they would start under the bottom edge of the frame.
      const pitches = spotData.current.map((s) => Math.asin(s.d.y)).sort((a, b) => a - b);
      const towardSeats = pitches.length ? Math.max(-0.6, Math.min(0, pitches[Math.floor(pitches.length / 2)])) : 0;
      const look = { yaw: (headingRef.current * Math.PI) / 180, pitch: towardSeats, auto: spotData.current.length === 0 };
      let down = null;
      const pinch = new Map();
      const onDown = (e) => {
        look.auto = false;
        dragged.current = false;
        pinch.set(e.pointerId, e.clientX);
        down = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch };
        // Not on a dot: capturing would send the tap's click to the frame
        // instead of the button under the finger.
        if (!e.target.closest?.('.es-pano__spot')) host.setPointerCapture?.(e.pointerId);
        el.style.cursor = 'grabbing';
      };
      const onMove = (e) => {
        if (!down || pinch.size > 1) return;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) dragged.current = true;
        look.yaw = down.yaw + (e.clientX - down.x) * 0.004;
        look.pitch = Math.max(-1.3, Math.min(1.3, down.pitch + (e.clientY - down.y) * 0.004));
      };
      // A tap is resolved HERE, by what is under the pointer when it lifts,
      // not by the button's own click: Chrome was seen delivering the press
      // to the canvas beneath a dot that elementsFromPoint put on top, and
      // the frame's pointer capture sends touch taps to the frame anyway.
      const onUp = (e) => {
        const tap = down && !dragged.current && pinch.size <= 1;
        pinch.delete(e.pointerId);
        down = null;
        el.style.cursor = 'grab';
        if (!tap) return;
        const hit = document.elementsFromPoint(e.clientX, e.clientY)
          .find((n) => n.classList?.contains('es-pano__spot') && host.contains(n));
        if (hit && !hit.disabled) onSpotRef.current?.(hit.dataset.spot);
      };
      const onWheel = (e) => {
        e.preventDefault();
        look.auto = false;
        camera.fov = Math.max(30, Math.min(95, camera.fov + e.deltaY * 0.04));
        camera.updateProjectionMatrix();
      };
      host.addEventListener('pointerdown', onDown);
      host.addEventListener('pointermove', onMove);
      host.addEventListener('pointerup', onUp);
      host.addEventListener('pointercancel', onUp);
      host.addEventListener('wheel', onWheel, { passive: false });

      const resize = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const v = new THREE.Vector3();
      const forward = new THREE.Vector3();
      renderer.setAnimationLoop(() => {
        if (look.auto && !reduce && !spotData.current.length) look.yaw -= 0.0007;
        camera.lookAt(
          -Math.sin(look.yaw) * Math.cos(look.pitch),
          Math.sin(look.pitch),
          -Math.cos(look.yaw) * Math.cos(look.pitch),
        );
        renderer.render(scene, camera);
        placeSpots();
      });

      // Each dot to where its seat is on screen, sized like the chair: near
      // seats get a bigger target, far rows smaller dots that overlap less.
      function placeSpots() {
        const list = spotData.current;
        if (!list.length) return;
        camera.updateMatrixWorld();
        camera.getWorldDirection(forward);
        const w = host.clientWidth;
        const h = host.clientHeight;
        const perPx = (h / 2) / Math.tan((camera.fov * Math.PI) / 360);
        for (const s of list) {
          const node = spotEls.current.get(s.id);
          if (!node) continue;
          v.set(s.d.x, s.d.y, s.d.z);
          if (v.dot(forward) < 0.2) { node.style.visibility = 'hidden'; continue; }
          v.project(camera);
          const x = (v.x + 1) / 2 * w;
          const y = (1 - v.y) / 2 * h;
          if (x < -20 || y < -20 || x > w + 20 || y > h + 20) { node.style.visibility = 'hidden'; continue; }
          const size = Math.max(12, Math.min(34, (0.42 / Math.max(0.5, s.distance)) * perPx));
          node.style.visibility = 'visible';
          node.style.width = `${size}px`;
          node.style.height = `${size}px`;
          node.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
        }
      }

      cleanup = () => {
        renderer.setAnimationLoop(null);
        ro.disconnect();
        host.removeEventListener('pointerdown', onDown);
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerup', onUp);
        host.removeEventListener('pointercancel', onUp);
        host.removeEventListener('wheel', onWheel);
        material.map?.dispose();
        material.dispose();
        geometry.dispose();
        renderer.dispose();
        renderer.forceContextLoss?.();
        el.remove();
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, [url, attempt]);

  if (state !== 'loading' && state !== 'ready') {
    return <ViewerProblem kind={state} what="360° view" onRetry={retry} onFallback={onFallback} className={className} />;
  }

  return (
    <div
      ref={hostRef}
      role={spots?.length ? 'group' : 'img'}
      aria-label={label}
      className={`es-venue3d relative overflow-hidden rounded-(--es-radius-lg) ${className}`}
    >
      {state === 'loading' && <div className="es-venue3d__loading" aria-hidden="true"><span /></div>}
      {state === 'ready' && spots?.length > 0 && (
        <div className="es-pano__spots">
          {spots.map((s) => (
            <button
              key={s.id}
              type="button"
              data-spot={s.id}
              ref={(node) => { if (node) spotEls.current.set(s.id, node); else spotEls.current.delete(s.id); }}
              className={`es-pano__spot es-pano__spot--${s.state || 'open'} ${s.active ? 'is-active' : ''} ${s.dim ? 'is-dim' : ''}`}
              style={{ visibility: 'hidden', ...(s.color ? { '--seat-tier': s.color } : null) }}
              disabled={s.disabled}
              aria-pressed={s.state === 'chosen'}
              aria-label={s.label}
              title={s.label}
              // Keyboard only (Enter/Space, detail 0); a pointer tap is
              // handled by the frame's pointerup so it is never counted twice.
              onClick={(e) => { if (e.detail === 0) onSpot?.(s.id); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
