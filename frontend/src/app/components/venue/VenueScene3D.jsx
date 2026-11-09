'use client';

import { useEffect, useRef, useState } from 'react';
import { buildRoom, disposeTree, MOOD_STYLE } from './roomBuilder';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The venue in 3D, and the 360° view from any seat in it. One renderer, two
 * cameras:
 *
 *   • `mode="orbit"` — the room as an object: drag to turn it, scroll or pinch
 *     to zoom, tap a seat to pick it.
 *   • `mode="eye"`   — a person in a seat: the camera flies to `eye.position`
 *     and drag looks around. This is what makes every seat on every map have a
 *     view, generated from the layout, without anyone photographing it.
 *
 * three.js is imported INSIDE the effect, so it is fetched only when a 3D or
 * 360° view is first opened, and never on the server.
 *
 * The room is rebuilt when `buildKey` changes (the layout, the scene settings)
 * and only RECOLOURED when `colorKey` changes (selection, availability, a tier
 * highlight). A buyer choosing seats never pays for a rebuild.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VenueScene3D({
  model, scene, labels = [], title = '', buildKey, colorKey, colorFor,
  mode = 'orbit', eye = null, onPick, onHover, controlsRef, className = '', ariaLabel = 'Venue in 3D',
}) {
  const hostRef = useRef(null);
  const stateRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  // Latest callbacks, read by handlers bound once. Written in an effect, never
  // during render.
  const live = useRef({ colorFor, onPick, onHover, mode, eye });
  useEffect(() => { live.current = { colorFor, onPick, onHover, mode, eye }; });

  // ── renderer, camera, controls: once ─────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    const host = hostRef.current;
    let cleanup = () => {};
    (async () => {
      const THREE = await import('three');
      const [{ OrbitControls }, { RoomEnvironment }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import('three/examples/jsm/controls/OrbitControls.js'),
        import('three/examples/jsm/environments/RoomEnvironment.js'),
        import('three/examples/jsm/postprocessing/EffectComposer.js'),
        import('three/examples/jsm/postprocessing/RenderPass.js'),
        import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
        import('three/examples/jsm/postprocessing/OutputPass.js'),
      ]);
      if (disposed || !host) return;

      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      } catch {
        setFailed(true);
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      renderer.domElement.style.touchAction = 'none';
      renderer.domElement.style.display = 'block';
      renderer.domElement.setAttribute('aria-hidden', 'true');
      host.appendChild(renderer.domElement);

      const scene3 = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);

      // IMAGE-BASED LIGHT: a neutral studio environment the materials reflect,
      // which is most of the difference between "lit boxes" and "a room".
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene3.environment = envMap;

      // GLOW on the screens, the truss lamps, the step lights and the rim.
      // Rendered at half resolution: bloom is a blur, so the detail is not
      // missed, and it halves the cost on a phone.
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene3, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.9);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI * 0.47;
      controls.screenSpacePanning = false;

      const st = {
        THREE, renderer, composer, bloom, scene: scene3, camera, controls, room: null, model: null,
        raycaster: new THREE.Raycaster(), pointer: new THREE.Vector2(),
        flight: null, look: { yaw: 0, pitch: 0 }, home: null, hovered: -1,
      };
      stateRef.current = st;

      const resize = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h, false);
        composer.setSize(w, h);
        bloom.resolution.set(w / 2, h / 2);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      // ── picking ──
      const seatAt = (clientX, clientY) => {
        if (!st.room || !st.model) return -1;
        const rect = renderer.domElement.getBoundingClientRect();
        st.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        st.raycaster.setFromCamera(st.pointer, camera);
        const hit = st.raycaster.intersectObjects([st.room.seatMesh, st.room.backMesh], false)[0];
        return hit ? hit.instanceId : -1;
      };

      let down = null;
      const onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), yaw: st.look.yaw, pitch: st.look.pitch }; };
      const onMove = (e) => {
        if (down && live.current.mode === 'eye' && e.buttons) {
          // Grab the world: dragging right turns the view left, as every
          // photo sphere does.
          st.look.yaw = down.yaw + (e.clientX - down.x) * 0.005;
          st.look.pitch = Math.max(-1.2, Math.min(1.2, down.pitch + (e.clientY - down.y) * 0.005));
          return;
        }
        if (e.buttons || live.current.mode === 'eye') return;
        const i = seatAt(e.clientX, e.clientY);
        if (i !== st.hovered) {
          st.hovered = i;
          renderer.domElement.style.cursor = i >= 0 ? 'pointer' : 'grab';
          const rect = host.getBoundingClientRect();
          live.current.onHover?.(i >= 0 ? st.model.seats[i] : null, { x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
      };
      const onUp = (e) => {
        if (!down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        const quick = performance.now() - down.t < 600;
        down = null;
        if (moved > 6 || !quick || live.current.mode === 'eye') return;
        const i = seatAt(e.clientX, e.clientY);
        if (i >= 0) {
          const rect = host.getBoundingClientRect();
          live.current.onPick?.(st.model.seats[i], { x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
      };
      const onWheel = (e) => {
        if (live.current.mode !== 'eye') return;
        e.preventDefault();
        camera.fov = Math.max(28, Math.min(80, camera.fov + e.deltaY * 0.03));
        camera.updateProjectionMatrix();
      };
      const el = renderer.domElement;
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointerleave', () => { if (st.hovered >= 0) { st.hovered = -1; live.current.onHover?.(null); } });
      el.addEventListener('wheel', onWheel, { passive: false });

      // ── frame loop ──
      const clock = new THREE.Clock();
      renderer.setAnimationLoop(() => {
        const t = clock.getElapsedTime();
        if (st.flight) {
          const f = st.flight;
          const k = Math.min(1, (performance.now() - f.start) / f.ms);
          const e = k < 0.5 ? 4 * k * k * k : 1 - ((-2 * k + 2) ** 3) / 2;
          camera.position.lerpVectors(f.from, f.to, e);
          const target = new THREE.Vector3().lerpVectors(f.fromTarget, f.toTarget, e);
          camera.lookAt(target);
          if (k >= 1) {
            st.flight = null;
            if (f.then === 'orbit') { controls.target.copy(f.toTarget); controls.enabled = true; }
          }
        } else if (live.current.mode === 'eye') {
          const dir = new THREE.Vector3(
            -Math.sin(st.look.yaw) * Math.cos(st.look.pitch),
            Math.sin(st.look.pitch),
            -Math.cos(st.look.yaw) * Math.cos(st.look.pitch),
          );
          camera.lookAt(camera.position.clone().add(dir));
        } else {
          controls.update();
        }
        const seated = live.current.mode === 'eye' || st.flight?.then === 'eye';
        for (const b of st.room?.badges || []) b.visible = !seated;
        for (const p of st.room?.animated || []) {
          p.rotation.set(0.5 + Math.sin(t * 0.7 + p.userData.phase) * 0.18, p.userData.facing, Math.sin(t * 0.9 + p.userData.phase) * 0.3, 'YXZ');
        }
        composer.render();
      });

      if (controlsRef) {
        controlsRef.current = {
          zoom: (factor) => {
            if (live.current.mode === 'eye') {
              camera.fov = Math.max(28, Math.min(80, camera.fov / factor));
              camera.updateProjectionMatrix();
              return;
            }
            const offset = camera.position.clone().sub(controls.target).multiplyScalar(1 / factor);
            camera.position.copy(controls.target).add(offset);
          },
          reset: () => { if (st.home) flyTo(st, st.home.position, st.home.target, 'orbit'); },
        };
      }

      setReady(true);
      cleanup = () => {
        renderer.setAnimationLoop(null);
        ro.disconnect();
        controls.dispose();
        if (st.room) disposeTree(st.room.group);
        composer.dispose?.();
        envMap.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.forceContextLoss?.();
        el.remove();
        stateRef.current = null;
      };
    })();
    return () => { disposed = true; cleanup(); };
    // Bound once; everything that changes is read through refs or the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── the room: rebuilt when the layout or scene changes ───────────────────
  useEffect(() => {
    const st = stateRef.current;
    if (!ready || !st || !model) return;
    const { THREE } = st;
    if (st.room) { st.scene.remove(st.room.group); disposeTree(st.room.group); }
    const style = MOOD_STYLE[scene.mood] || MOOD_STYLE.concert;
    st.scene.background = new THREE.Color(style.background);
    st.scene.fog = new THREE.Fog(style.fog, model.radius * 2.2, model.radius * 5);
    st.room = buildRoom(THREE, model, scene, { title, labels });
    st.scene.environmentIntensity = style.env ?? 0.6;
    st.bloom.strength = style.bloom ?? 0.5;
    st.model = model;
    st.scene.add(st.room.group);

    // Home: behind the room, opposite the stage, high enough to read rows.
    const len = Math.hypot(model.focus.x, model.focus.z) || 1;
    const back = { x: -model.focus.x / len, z: -model.focus.z / len };
    // A portrait phone sees a narrow slice, so it stands further back to fit
    // the room's width rather than cropping the side sections.
    const narrow = Math.max(1, 1.3 / (st.camera.aspect || 1));
    const dist = Math.max(14, model.radius * 0.95) * narrow;
    st.home = {
      position: new THREE.Vector3(back.x * dist, Math.max(11, model.radius * 1.0 + model.topRise) * narrow, back.z * dist),
      target: new THREE.Vector3(model.focus.x * 0.25, model.topRise * 0.3, model.focus.z * 0.25),
    };
    st.controls.minDistance = 4;
    st.controls.maxDistance = model.radius * 4 + 30;
    // Framed once. A rebuild from a settings slider (the rake, the lighting)
    // must not yank the camera away from where the organizer was looking.
    if (live.current.mode !== 'eye' && !st.framed) {
      st.framed = true;
      st.camera.position.copy(st.home.position);
      st.controls.target.copy(st.home.target);
      st.controls.update();
    }
    recolor(st, live.current.colorFor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, buildKey]);

  // ── colours only ─────────────────────────────────────────────────────────
  useEffect(() => {
    const st = stateRef.current;
    if (ready && st?.room) recolor(st, colorFor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, colorKey, buildKey]);

  // ── camera: orbit ⇄ seat eye ─────────────────────────────────────────────
  const eyeKey = eye ? `${eye.position.x},${eye.position.y},${eye.position.z},${eye.target.x},${eye.target.z}` : '';
  useEffect(() => {
    const st = stateRef.current;
    if (!ready || !st?.home) return;
    const { THREE } = st;
    if (mode === 'eye' && eye) {
      const to = new THREE.Vector3(eye.position.x, eye.position.y, eye.position.z);
      const target = new THREE.Vector3(eye.target.x, eye.target.y, eye.target.z);
      const d = target.clone().sub(to);
      st.look.yaw = Math.atan2(-d.x, -d.z);
      st.look.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      st.controls.enabled = false;
      st.camera.fov = 62;
      st.camera.updateProjectionMatrix();
      flyTo(st, to, target, 'eye');
    } else if (mode === 'orbit') {
      st.camera.fov = 50;
      st.camera.updateProjectionMatrix();
      flyTo(st, st.home.position, st.home.target, 'orbit');
    }
  }, [ready, mode, eyeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) {
    return (
      <div className={`grid place-items-center rounded-(--es-radius-lg) border border-border-base bg-bg-sunken p-6 text-center ${className}`}>
        <p className="max-w-sm text-sm text-muted">
          The 3D view needs WebGL, which is turned off in this browser. The 2D map shows every seat.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={ariaLabel}
      className={`es-venue3d relative overflow-hidden rounded-(--es-radius-lg) ${className}`}
    >
      {!ready && <div className="es-venue3d__loading" aria-hidden="true"><span /></div>}
    </div>
  );
}

function flyTo(st, to, target, then) {
  const from = st.camera.position.clone();
  const dir = new st.THREE.Vector3();
  st.camera.getWorldDirection(dir);
  const fromTarget = from.clone().add(dir.multiplyScalar(Math.max(1, from.distanceTo(target))));
  st.controls.enabled = false;
  st.flight = {
    from, to: to.clone(), fromTarget, toTarget: target.clone(), start: performance.now(),
    ms: from.distanceTo(to) < 0.5 ? 1 : 1100, then,
  };
}

function recolor(st, colorFor) {
  const { THREE, room, model } = st;
  if (!room || !model || !colorFor) return;
  const c = new THREE.Color();
  model.seats.forEach((s, i) => {
    c.set(colorFor(s) || '#9aa4a8');
    room.seatMesh.setColorAt(i, c);
    room.backMesh.setColorAt(i, c.multiplyScalar(0.82));
  });
  if (room.seatMesh.instanceColor) room.seatMesh.instanceColor.needsUpdate = true;
  if (room.backMesh.instanceColor) room.backMesh.instanceColor.needsUpdate = true;
}
