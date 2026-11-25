'use client';

import { useEffect, useRef, useState } from 'react';
import { buildRoom, disposeTree, MOOD_STYLE } from './roomBuilder';
import ViewerProblem from './ViewerProblem';
import { createScreenPainter } from './stage/screenPainter';
import { createStageSound, idleBeat } from './stage/stageSound';
import { DEFAULT_SCREEN, soundFor } from './stage/screenModel';

/** Past this with nothing drawn, the 3D code is not coming: say so. */
const LOAD_TIMEOUT_MS = 25_000;

/**
 * Touch devices get the light renderer: no glow pass, a lower pixel ratio, no
 * idle animation, and a frame drawn only when something changed. Phones are
 * where iOS drops a page's GPU work when memory runs low, which is what left
 * buyers looking at a black box.
 */
function lightRenderer() {
  try { return Boolean(window.matchMedia?.('(pointer: coarse)').matches); } catch { return false; }
}

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
 *
 * IT NEVER FAILS SILENTLY. The 3D code not arriving, WebGL being off, and the
 * device dropping the GPU context mid-view each show a message
 * (ViewerProblem) with "Try again" and, where the caller passes `onFallback`,
 * "Use the 2D map" — instead of the dark background on its own.
 *
 * THE STAGE SCREEN IS A SHOW (2026-11-25, stage/). Every screen in the room
 * shares one canvas texture that `screenPainter` draws: the organizer's
 * slides (`screen`, from scene.screen) filled from the event (`screenFeed`).
 * It repaints on its own budget — 30 fps on a desktop, 10 on a phone, 4 in
 * the editor's small preview, once a second for reduced motion — and a tap
 * on a screen moves it to the next slide. SHOWTIME (`controlsRef.showtime`,
 * from a button: browsers play sound only after a tap) dims the house
 * lights, swings the beams in the screen's colour, pulses the rim to the
 * music and plays the soundtrack from the stage (stageSound.js). The CAMERA
 * NEVER MOVES for any of it (the owner's rule, 2026-11-19): only the room's
 * lights and the screen do.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VenueScene3D({
  model, scene, labels = [], title = '', buildKey, colorKey, colorFor,
  mode = 'orbit', eye = null, onPick, onHover, onFallback, controlsRef, className = '', ariaLabel = 'Venue in 3D',
  // The stage screen's settings (screenModel.readScreen) and what fills it:
  // { title, startsAt, endsAt, timezone, venueName, coverUrl, logoUrl,
  //   lineup: [...], sponsors: [...] } from the map API. Either may be null.
  screen = null, screenFeed = null,
  // The organizer's track would not play; the Eventsli loop plays instead.
  onTrackFailed = null,
  // The small preview beside the editor (owner, 2026-11-19: "not clear on
  // the side"): no glow pass, which blurs detail at that size; no table
  // numbers, which crowd it; a higher, closer camera that shows the layout;
  // and fog pushed back so the far tables are not faded.
  compact = false,
}) {
  const hostRef = useRef(null);
  const stateRef = useRef(null);
  // null, or why the view cannot draw: 'nogl' | 'load' | 'lost'.
  const [problem, setProblem] = useState(null);
  const [ready, setReady] = useState(false);
  // Bumped by "Try again": the renderer effect runs from scratch.
  const [attempt, setAttempt] = useState(0);
  const retry = () => { setProblem(null); setReady(false); setAttempt((a) => a + 1); };
  const screenLayout = { size: screen?.size ?? 100, sides: screen?.sides !== false };

  // Latest callbacks, read by handlers bound once. Written in an effect, never
  // during render.
  const live = useRef({ colorFor, onPick, onHover, mode, eye, screen, scene, onTrackFailed });
  useEffect(() => { live.current = { colorFor, onPick, onHover, mode, eye, screen, scene, onTrackFailed }; });

  // ── renderer, camera, controls: once ─────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    // Set when the load took too long and the message is already up; a late
    // arrival must not then draw into a box that is no longer on the page.
    let abandoned = false;
    const host = hostRef.current;
    let cleanup = () => {};
    const slow = setTimeout(() => {
      if (disposed || stateRef.current) return;
      abandoned = true;
      setProblem('load');
    }, LOAD_TIMEOUT_MS);
    (async () => {
      let THREE;
      let mods;
      try {
        THREE = await import('three');
        mods = await Promise.all([
          import('three/examples/jsm/controls/OrbitControls.js'),
          import('three/examples/jsm/environments/RoomEnvironment.js'),
          import('three/examples/jsm/postprocessing/EffectComposer.js'),
          import('three/examples/jsm/postprocessing/RenderPass.js'),
          import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
          import('three/examples/jsm/postprocessing/OutputPass.js'),
        ]);
      } catch {
        // A chunk that did not arrive: a weak connection, or a deploy that
        // replaced the files under an open page. Both are worth a retry.
        clearTimeout(slow);
        if (!disposed && !abandoned) setProblem('load');
        return;
      }
      const [{ OrbitControls }, { RoomEnvironment }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = mods;
      if (disposed || abandoned || !host) return;

      const light = lightRenderer();
      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: light ? 'default' : 'high-performance' });
      } catch {
        clearTimeout(slow);
        setProblem('nogl');
        return;
      }
      clearTimeout(slow);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, light ? 1.5 : 2));
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
      // missed. Desktop only: on a phone it is the most expensive thing on the
      // page, and the renderer then applies tone mapping and colour itself.
      let composer = null;
      let bloom = null;
      if (!light && !compact) {
        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene3, camera));
        bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.9);
        composer.addPass(bloom);
        composer.addPass(new OutputPass());
      }
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI * 0.47;
      controls.screenSpacePanning = false;
      if (compact) {
        // The side preview turns with a drag and nothing else: the wheel and
        // a one-finger swipe scroll the page past it, as on the 2D maps
        // (usePanZoom, 2026-11-19). "Open 3D" is the full, zoomable view.
        controls.enableZoom = false;
        controls.enablePan = false;
        renderer.domElement.style.touchAction = 'pan-x pan-y';
      }

      // ── the stage screen's show ──
      const still = (() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
      const painter = createScreenPainter({
        width: light || compact ? 960 : 1280,
        // An image or a font arrived: paint again at once.
        onAsset: () => { if (stateRef.current) { stateRef.current.show.due = 0; stateRef.current.invalidate(); } },
      });
      painter.setStill(still);
      const screenTex = new THREE.CanvasTexture(painter.canvas);
      screenTex.colorSpace = THREE.SRGBColorSpace;
      screenTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy?.() || 1);
      screenTex.userData.shared = true;

      const st = {
        THREE, renderer, composer, bloom, light, scene: scene3, camera, controls, room: null, model: null,
        raycaster: new THREE.Raycaster(), pointer: new THREE.Vector2(),
        flight: null, look: { yaw: 0, pitch: 0 }, home: null, hovered: -1,
        // A frame is drawn only when something changed (`invalidate`), while
        // a camera flight or the controls' damping is moving, or — desktop
        // only — while the room has animated props.
        dirty: true,
        invalidate: () => { st.dirty = true; },
        show: {
          painter, texture: screenTex, still, due: 0, sampleAt: 0, audio: null,
          tint: new THREE.Color(0xffffff), target: 0, k: 0, sound: null, soundKey: '',
          // Per frame, repaints per second: a phone and the small preview
          // keep the GPU quiet unless Showtime asks for more.
          fps: (on) => (still ? 1 : compact ? 4 : on ? (light ? 24 : 30) : (light ? 6 : 24)),
          // Scrolled out of sight, the screen is not repainted at all.
          visible: true,
        },
      };
      stateRef.current = st;
      controls.addEventListener('change', st.invalidate);
      const seen = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(([entry]) => { st.show.visible = entry.isIntersecting; if (entry.isIntersecting) st.invalidate(); })
        : null;
      seen?.observe(host);

      const resize = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h, false);
        composer?.setSize(w, h);
        bloom?.resolution.set(w / 2, h / 2);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        st.invalidate();
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
      // Whether the last `seatAt` ray also passes through a screen.
      const onScreen = () => {
        const screens = st.room?.show?.screens;
        return Boolean(screens?.length && st.raycaster.intersectObjects(screens, false).length);
      };

      let down = null;
      const onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), yaw: st.look.yaw, pitch: st.look.pitch }; };
      const onMove = (e) => {
        if (down && live.current.mode === 'eye' && e.buttons) {
          // Grab the world: dragging right turns the view left, as every
          // photo sphere does.
          st.look.yaw = down.yaw + (e.clientX - down.x) * 0.005;
          st.look.pitch = Math.max(-1.2, Math.min(1.2, down.pitch + (e.clientY - down.y) * 0.005));
          if (st.hovered >= 0) { st.hovered = -1; live.current.onHover?.(null); }
          st.invalidate();
          return;
        }
        if (e.buttons) return;
        const i = seatAt(e.clientX, e.clientY);
        if (i < 0) {
          // A screen says it can be tapped: it moves to the next slide.
          const screenHit = onScreen();
          renderer.domElement.style.cursor = screenHit ? 'pointer' : 'grab';
          renderer.domElement.title = screenHit ? 'Tap for the next slide' : '';
        } else {
          renderer.domElement.title = '';
        }
        if (i !== st.hovered) {
          st.hovered = i;
          if (i >= 0) renderer.domElement.style.cursor = 'pointer';
          const rect = host.getBoundingClientRect();
          live.current.onHover?.(i >= 0 ? st.model.seats[i] : null, { x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
      };
      const onUp = (e) => {
        if (!down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        const quick = performance.now() - down.t < 600;
        down = null;
        // A tap picks a seat in both modes; in 360° a drag looks around and
        // the distance check above is what tells the two apart.
        if (moved > 6 || !quick) return;
        const i = seatAt(e.clientX, e.clientY);
        if (i >= 0) {
          const rect = host.getBoundingClientRect();
          live.current.onPick?.(st.model.seats[i], { x: e.clientX - rect.left, y: e.clientY - rect.top });
        } else if (onScreen()) {
          st.show.painter.skip();
          st.show.due = 0;
          st.invalidate();
        }
      };
      const onWheel = (e) => {
        if (live.current.mode !== 'eye') return;
        e.preventDefault();
        camera.fov = Math.max(28, Math.min(80, camera.fov + e.deltaY * 0.03));
        camera.updateProjectionMatrix();
        st.invalidate();
      };
      const el = renderer.domElement;
      // iOS drops a page's GPU context when memory runs low, and the canvas
      // simply goes dark. Stop drawing and say so; "Try again" rebuilds it.
      el.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        if (disposed) return;   // our own cleanup forces a loss too
        renderer.setAnimationLoop(null);
        st.show.sound?.stop();
        setProblem('lost');
      });
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointerleave', () => { if (st.hovered >= 0) { st.hovered = -1; live.current.onHover?.(null); } });
      el.addEventListener('wheel', onWheel, { passive: false });

      // ── frame loop ──
      const clock = new THREE.Clock();
      const draw = composer ? () => composer.render() : () => renderer.render(scene3, camera);
      renderer.setAnimationLoop(() => {
        const t = clock.getElapsedTime();
        const flying = Boolean(st.flight);
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
          controls.update();   // fires 'change' (→ invalidate) while damping moves
        }
        const animate = !light && (st.room?.animated?.length || 0) > 0;
        const showing = stepShow(st, t, live.current.screen);
        if (!flying && !st.dirty && !animate && !showing) return;
        st.dirty = false;
        const seated = live.current.mode === 'eye' || st.flight?.then === 'eye';
        for (const b of st.room?.badges || []) b.visible = !seated;
        if (animate || st.show.k > 0.001) {
          // The beams sway; in Showtime they swing faster with the music.
          const pace = 1 + st.show.k * (0.6 + (st.show.audio?.level || 0) * 1.4);
          const tt = st.show.still ? 0 : t * pace;
          for (const { pivot } of st.room?.show?.beams || []) {
            if (!pivot.visible) continue;
            pivot.rotation.set(0.5 + Math.sin(tt * 0.7 + pivot.userData.phase) * 0.18, pivot.userData.facing, Math.sin(tt * 0.9 + pivot.userData.phase) * 0.3, 'YXZ');
          }
        }
        draw();
      });

      // A hidden tab plays nothing; it picks up where it was when it is back.
      const onVisibility = () => {
        if (document.hidden) st.show.sound?.pause();
        else if (st.show.target) st.show.sound?.resume();
      };
      document.addEventListener('visibilitychange', onVisibility);

      if (controlsRef) {
        controlsRef.current = {
          zoom: (factor) => {
            if (live.current.mode === 'eye') {
              camera.fov = Math.max(28, Math.min(80, camera.fov / factor));
              camera.updateProjectionMatrix();
              st.invalidate();
              return;
            }
            const offset = camera.position.clone().sub(controls.target).multiplyScalar(1 / factor);
            camera.position.copy(controls.target).add(offset);
            st.invalidate();
          },
          reset: () => { if (st.home) flyTo(st, st.home.position, st.home.target, 'orbit'); },
          /**
           * Lights down, music up — or back. Call it from the tap itself:
           * the soundtrack is created here, inside the gesture, which is
           * the only time a browser lets a page start sound. Returns what
           * is playing, for the button to say.
           */
          showtime: (on) => {
            const sh = st.show;
            sh.target = on ? 1 : 0;
            if (on) {
              const spec = soundFor(live.current.screen || DEFAULT_SCREEN, live.current.scene?.mood);
              const key = JSON.stringify(spec);
              if (sh.sound && sh.soundKey !== key) { sh.sound.dispose(); sh.sound = null; }
              if (!sh.sound && spec.kind !== 'off') {
                sh.sound = createStageSound({
                  sound: spec,
                  roomRadius: st.model?.radius || 20,
                  onTrackFailed: () => live.current.onTrackFailed?.(),
                });
                sh.soundKey = key;
              }
              const at = st.room?.show?.anchor;
              if (at) sh.sound?.place(at.x, at.y, at.z);
              sh.sound?.start();
            } else {
              sh.sound?.stop();
            }
            sh.due = 0;
            st.invalidate();
            return { name: sh.sound?.name || null, sound: Boolean(sh.sound) };
          },
          mute: (muted) => st.show.sound?.setMuted(muted),
          nextSlide: () => { st.show.painter.skip(); st.show.due = 0; st.invalidate(); },
        };
      }

      setReady(true);
      cleanup = () => {
        renderer.setAnimationLoop(null);
        ro.disconnect();
        seen?.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        st.show.sound?.dispose();
        st.show.sound = null;
        controls.removeEventListener('change', st.invalidate);
        controls.dispose();
        if (st.room) disposeTree(st.room.group);
        screenTex.dispose();
        painter.dispose();
        composer?.dispose?.();
        envMap.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.forceContextLoss?.();
        el.remove();
        stateRef.current = null;
      };
    })();
    return () => { disposed = true; clearTimeout(slow); cleanup(); };
    // Bound once per attempt; everything that changes is read through refs or
    // the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // ── the room: rebuilt when the layout or scene changes ───────────────────
  useEffect(() => {
    const st = stateRef.current;
    if (!ready || !st || !model) return;
    const { THREE } = st;
    if (st.room) { st.scene.remove(st.room.group); disposeTree(st.room.group); }
    const style = MOOD_STYLE[scene.mood] || MOOD_STYLE.concert;
    st.scene.background = new THREE.Color(style.background);
    st.scene.fog = compact
      ? new THREE.Fog(style.fog, model.radius * 4, model.radius * 8)
      : new THREE.Fog(style.fog, model.radius * 2.2, model.radius * 5);
    st.room = buildRoom(THREE, model, scene, {
      title, labels, tableNumbers: !compact,
      screenTexture: st.show.texture,
      screenLayout: { size: screenLayout.size, sides: screenLayout.sides },
    });
    // The music comes from the new room's screen.
    const at = st.room.show.anchor;
    if (at) st.show.sound?.place(at.x, at.y, at.z);
    st.show.due = 0;
    st.scene.environmentIntensity = style.env ?? 0.6;
    if (st.bloom) st.bloom.strength = style.bloom ?? 0.5;
    st.model = model;
    st.scene.add(st.room.group);
    st.invalidate();

    // Home: behind the room, opposite the stage, high enough to read rows.
    const len = Math.hypot(model.focus.x, model.focus.z) || 1;
    const back = { x: -model.focus.x / len, z: -model.focus.z / len };
    // A portrait phone sees a narrow slice, so it stands further back to fit
    // the room's width rather than cropping the side sections.
    const narrow = Math.max(1, 1.3 / (st.camera.aspect || 1));
    const dist = Math.max(14, model.radius * 0.95) * narrow;
    st.home = compact
      // About 64° down onto the middle of the room, far enough for the whole
      // room to fit a 50° lens: the layout reads like the 2D map beside it.
      ? {
        position: new THREE.Vector3(back.x * Math.max(6, model.radius * 0.9) * narrow, (Math.max(12, model.radius * 1.9) + model.topRise) * narrow, back.z * Math.max(6, model.radius * 0.9) * narrow),
        target: new THREE.Vector3(0, model.topRise * 0.3, 0),
      }
      : {
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
    // The screen's size and side screens are geometry: a rebuild. What it
    // SHOWS is not (the effect below), so typing a message never rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, buildKey, screenLayout.size, screenLayout.sides]);

  // ── what the screen shows: repainted, never rebuilt ──────────────────────
  useEffect(() => {
    const st = stateRef.current;
    if (!ready || !st) return;
    st.show.painter.setContent({ screen: screen || DEFAULT_SCREEN, feed: screenFeed, title });
    st.show.due = 0;
    // A new soundtrack chosen while one plays: the next Showtime starts it.
    if (st.show.sound && st.show.soundKey !== JSON.stringify(soundFor(screen || DEFAULT_SCREEN, scene?.mood)) && !st.show.target) {
      st.show.sound.dispose();
      st.show.sound = null;
    }
    st.invalidate();
  }, [ready, screen, screenFeed, title, scene?.mood]);

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

  if (problem) {
    return (
      <ViewerProblem
        kind={problem}
        what={mode === 'eye' ? '360° view' : '3D view'}
        onRetry={retry}
        onFallback={onFallback}
        className={className}
      />
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

/**
 * One frame of the stage show: repaint the screen when its budget says so,
 * ease Showtime in or out, and move the room's lights with it. Returns true
 * when the frame must be drawn.
 */
function stepShow(st, t, screen) {
  const sh = st.show;
  const room = st.room?.show;
  if (!room) return false;
  const now = performance.now();
  let changed = false;

  // Showtime eases in over about a second and out a little faster.
  const before = sh.k;
  const rate = sh.target > sh.k ? 0.035 : 0.05;
  sh.k = Math.abs(sh.target - sh.k) < 0.002 ? sh.target : sh.k + (sh.target - sh.k) * rate * (sh.still ? 3 : 1);
  if (sh.k !== before) changed = true;

  if (room.screens.length && sh.visible && now >= sh.due) {
    sh.due = now + 1000 / sh.fps(sh.k > 0.01);
    sh.audio = sh.sound?.playing ? sh.sound.read() : sh.k > 0.01 ? idleBeat(t) : null;
    sh.painter.paint(now, sh.audio);
    sh.texture.needsUpdate = true;
    if (now >= sh.sampleAt) {
      sh.sampleAt = now + 160;
      const [r, g, b] = sh.painter.sample();
      sh.tint.setRGB(r, g, b, st.THREE.SRGBColorSpace);
    }
    changed = true;
  }

  if (sh.sound?.playing) {
    // The listener is the camera: the music is where the stage is.
    const fwd = new st.THREE.Vector3();
    st.camera.getWorldDirection(fwd);
    sh.sound.listen(st.camera.position, fwd, st.camera.up);
  }

  const k = sh.k;
  const react = screen?.react !== false;
  const level = react ? (sh.audio?.level || 0) : 0.3;
  const beat = react ? (sh.audio?.bass || 0) : 0;
  for (const h of room.house) h.light.intensity = h.base * (1 - 0.7 * k);
  if (room.glow) {
    // The screen lights the stage a little always, and the room in Showtime.
    // A brighter, whiter frame throws more.
    const bright = Math.max(sh.tint.r, sh.tint.g, sh.tint.b);
    room.glow.color.copy(sh.tint);
    room.glow.intensity = (6 + k * (30 + beat * 40)) * (0.4 + bright);
  }
  for (const p of room.pulse) p.material.color.copy(p.base).multiplyScalar(1 + k * (react ? beat * 2.2 - 0.15 : 0.4));
  for (const b of room.beams) {
    b.pivot.visible = b.always || k > 0.02;
    b.material.opacity = (b.always ? 0.07 : 0) + k * (0.05 + level * 0.2);
    b.material.color.copy(b.base).lerp(sh.tint, k * 0.75);
  }
  return changed || k > 0.001;
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
  st.invalidate?.();
}
