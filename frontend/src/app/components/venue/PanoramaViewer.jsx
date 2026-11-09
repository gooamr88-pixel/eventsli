'use client';

import { useEffect, useRef, useState } from 'react';

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
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function PanoramaViewer({ url, heading = 0, className = '', label = '360° view' }) {
  const hostRef = useRef(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    const host = hostRef.current;
    (async () => {
      const THREE = await import('three');
      if (disposed || !host) return;
      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
      } catch {
        setState('nogl');
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const el = renderer.domElement;
      el.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
      el.setAttribute('aria-hidden', 'true');
      host.appendChild(el);

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
      }, undefined, () => { if (!disposed) setState('error'); });

      const look = { yaw: (heading * Math.PI) / 180, pitch: 0, auto: true };
      let down = null;
      const pinch = new Map();
      const onDown = (e) => {
        look.auto = false;
        pinch.set(e.pointerId, e.clientX);
        down = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch };
        el.setPointerCapture?.(e.pointerId);
        el.style.cursor = 'grabbing';
      };
      const onMove = (e) => {
        if (!down || pinch.size > 1) return;
        look.yaw = down.yaw + (e.clientX - down.x) * 0.004;
        look.pitch = Math.max(-1.3, Math.min(1.3, down.pitch + (e.clientY - down.y) * 0.004));
      };
      const onUp = (e) => { pinch.delete(e.pointerId); down = null; el.style.cursor = 'grab'; };
      const onWheel = (e) => {
        e.preventDefault();
        look.auto = false;
        camera.fov = Math.max(30, Math.min(95, camera.fov + e.deltaY * 0.04));
        camera.updateProjectionMatrix();
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('wheel', onWheel, { passive: false });

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
      renderer.setAnimationLoop(() => {
        if (look.auto && !reduce) look.yaw -= 0.0007;
        camera.lookAt(
          -Math.sin(look.yaw) * Math.cos(look.pitch),
          Math.sin(look.pitch),
          -Math.cos(look.yaw) * Math.cos(look.pitch),
        );
        renderer.render(scene, camera);
      });

      cleanup = () => {
        renderer.setAnimationLoop(null);
        ro.disconnect();
        material.map?.dispose();
        material.dispose();
        geometry.dispose();
        renderer.dispose();
        renderer.forceContextLoss?.();
        el.remove();
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, [url, heading]);

  return (
    <div ref={hostRef} role="img" aria-label={label} className={`es-venue3d relative overflow-hidden rounded-(--es-radius-lg) ${className}`}>
      {state === 'loading' && <div className="es-venue3d__loading" aria-hidden="true"><span /></div>}
      {(state === 'error' || state === 'nogl') && (
        <p className="es-venue3d__msg absolute inset-0 grid place-items-center p-6 text-center text-sm">
          {state === 'nogl' ? 'This browser has WebGL turned off, so the 360° view cannot be shown.' : 'This 360° photo could not be loaded.'}
        </p>
      )}
    </div>
  );
}
