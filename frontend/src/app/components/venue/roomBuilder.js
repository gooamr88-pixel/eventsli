import { zoneMeta } from '../seating/venueZones';
import { screenSize } from './stage/screenModel';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Turns a scene model (sceneModel.js) into three.js objects.
 *
 * Takes the `THREE` module as an argument rather than importing it, because
 * three.js is loaded on demand by VenueScene3D — a buyer who never opens the
 * 3D view never downloads it — and this file is imported eagerly.
 *
 * PERFORMANCE IS A DESIGN CONSTRAINT, not a later pass: a map can hold 400
 * tables of 60 seats, 24,000 chairs. So every repeated thing is ONE instanced
 * mesh (chairs are two: cushion and back), there are no shadows, and the only
 * per-frame work is the light sway. A mid-range phone draws the largest map.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const MOOD_STYLE = Object.freeze({
  concert: {
    background: 0x0a1719, floor: 0x203236, riser: 0x2e454b, wall: 0x132629, fog: 0x0a1719,
    hemiSky: 0x8fd3d6, hemiGround: 0x1a2a2d, hemi: 1.1, sun: 0.7, cloth: 0x2a3c40, rim: 0x5fe0d6, env: 0.45, bloom: 0.75,
  },
  gala: {
    background: 0x1a120c, floor: 0x3a281c, riser: 0x4a3526, wall: 0x24180f, fog: 0x1a120c,
    hemiSky: 0xffd9a8, hemiGround: 0x2a1a10, hemi: 1.1, sun: 0.75, cloth: 0xf3ede4, rim: 0xffc879, env: 0.55, bloom: 0.6,
  },
  daylight: {
    background: 0xdfe8e9, floor: 0xc3cfd1, riser: 0xa9b6b9, wall: 0xd2dcde, fog: 0xdfe8e9,
    hemiSky: 0xffffff, hemiGround: 0x8a9799, hemi: 0.9, sun: 1.1, cloth: 0xffffff, rim: 0x17a2a6, env: 1.0, bloom: 0.18,
  },
});

/** A sprite of text on a rounded plate: section badges, zone names, STAGE. */
export function makeLabel(THREE, text, { bg = 'rgba(17,16,24,0.82)', fg = '#ffffff', height = 1.4, weight = 700, depthTest = false } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const px = 64;
  ctx.font = `${weight} ${px}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + px;
  canvas.width = w;
  canvas.height = px * 1.6;
  ctx.font = `${weight} ${px}px system-ui, -apple-system, Segoe UI, sans-serif`;
  if (bg) {
    ctx.fillStyle = bg;
    const r = canvas.height / 2.4;
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, r);
    ctx.fill();
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // No depth test by default: a label names a place and must not vanish
  // behind the seats it names, which is what made the 2D map's badges worth
  // copying. Table numbers opt in, since there are hundreds of them.
  // Tinted just under white so the bloom pass (threshold 0.9) leaves text crisp.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: 0xdedede, depthWrite: false, depthTest, transparent: true }));
  sprite.scale.set(height * (canvas.width / canvas.height), height, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/**
 * The big screen's picture when there is no show to play (the show is
 * stage/screenPainter.js; this is what a screen shows without one): a
 * stage-light gradient and the event's name. 16:9, as every screen is.
 */
function screenTexture(THREE, title) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 576;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(512, 600, 40, 512, 360, 700);
  g.addColorStop(0, '#ffd94d');
  g.addColorStop(0.35, '#ff414b');
  g.addColorStop(1, '#16070b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 576);
  for (let i = 0; i < 9; i += 1) {
    ctx.strokeStyle = `rgba(255,230,160,${0.05 + (i % 3) * 0.03})`;
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(512, 600);
    ctx.lineTo(i * 128, -40);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  // Shrunk to fit rather than cut: an event's name is the one thing on the screen.
  const name = (title || 'Live').slice(0, 60);
  let size = 72;
  do { ctx.font = `700 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`; size -= 4; } while (size > 28 && ctx.measureText(name).width > 900);
  ctx.fillText(name, 512, 305);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A theatre chair: an upholstered cushion and back (rounded, bevelled, so they
 * catch the light like padding rather than reading as boxes) on a dark metal
 * leg. Above 6,000 seats it drops to plain boxes: a stadium is seen from far
 * enough away that the bevel is invisible and the vertex count is not.
 */
function chairGeometries(THREE, count) {
  if (count > 6000) {
    const cushion = new THREE.BoxGeometry(0.46, 0.12, 0.44);
    cushion.translate(0, 0.42, 0);
    const back = new THREE.BoxGeometry(0.46, 0.5, 0.07);
    back.translate(0, 0.72, 0.2);
    const leg = new THREE.BoxGeometry(0.08, 0.36, 0.28);
    leg.translate(0, 0.18, 0.04);
    return { cushion, back, leg };
  }
  const pad = (w, h, depth, bevel) => {
    const r = Math.min(w, h) * 0.22;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 3,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  };
  const cushion = pad(0.44, 0.42, 0.06, 0.03);
  cushion.rotateX(-Math.PI / 2);
  cushion.translate(0, 0.43, -0.01);
  const back = pad(0.44, 0.5, 0.03, 0.025);
  back.rotateX(-0.16);
  back.translate(0, 0.74, 0.2);
  const leg = new THREE.BoxGeometry(0.07, 0.38, 0.26);
  leg.translate(0, 0.19, 0.05);
  return { cushion, back, leg };
}

/** The floor: a soft pool of light toward the stage and a faint grid. */
function floorTexture(THREE, style) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const ctx = c.getContext('2d');
  const base = new THREE.Color(style.floor);
  const lit = base.clone().lerp(new THREE.Color(0xffffff), 0.12);
  const g = ctx.createRadialGradient(512, 512, 40, 512, 512, 512);
  g.addColorStop(0, `#${lit.getHexString()}`);
  g.addColorStop(1, `#${base.getHexString()}`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 1024; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 1024); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(1024, i); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Builds the room. Returns the group to add to a scene, the two seat meshes
 * (for picking and colouring) and whatever needs animating.
 */
export function buildRoom(THREE, model, scene, {
  title, labels = [], tableNumbers: withNumbers = true,
  // The stage screen's show (VenueScene3D owns it): one canvas texture every
  // screen in the room shares, and the main screen's size and side screens.
  screenTexture: showTexture = null, screenLayout = null,
} = {}) {
  const style = MOOD_STYLE[scene.mood] || MOOD_STYLE.concert;
  const group = new THREE.Group();
  const animated = [];
  // What Showtime moves (VenueScene3D): the screens a tap can reach, the
  // house lights it dims, the glowing strips it pulses, the beams it swings,
  // the light the screen throws, and where the music comes from.
  const show = {
    screens: [], house: [], pulse: [], beams: [], glow: null, anchor: null,
    texture: showTexture, layout: { size: 100, sides: true, ...(screenLayout || {}) },
  };
  const R = model.radius;

  // ── floor and shell ──────────────────────────────────────────────────────
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(R + 14, 96),
    new THREE.MeshStandardMaterial({ map: floorTexture(THREE, style), roughness: 0.78, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  if (scene.roof) {
    const wallH = Math.max(8, model.topRise + 7);
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 12, R + 9, wallH, 96, 1, true),
      new THREE.MeshStandardMaterial({ color: style.wall, side: THREE.BackSide, roughness: 1 }),
    );
    wall.position.y = wallH / 2;
    group.add(wall);

    // A ring of lights at the rim — the arena's crown.
    const bulbs = 72;
    const lamp = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshBasicMaterial({ color: style.rim }),
      bulbs,
    );
    show.pulse.push({ material: lamp.material, base: new THREE.Color(style.rim) });
    const m = new THREE.Matrix4();
    for (let i = 0; i < bulbs; i += 1) {
      const a = (i / bulbs) * Math.PI * 2;
      m.makeTranslation(Math.cos(a) * (R + 11.2), wallH - 0.4, Math.sin(a) * (R + 11.2));
      lamp.setMatrixAt(i, m);
    }
    group.add(lamp);
  }

  // ── lights ───────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(style.hemiSky, style.hemiGround, style.hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  const sun = new THREE.DirectionalLight(0xffffff, style.sun);
  sun.position.set(R * 0.4, R * 1.2, R * 0.8);
  group.add(hemi, ambient, sun);
  show.house.push({ light: hemi, base: hemi.intensity }, { light: ambient, base: ambient.intensity }, { light: sun, base: sun.intensity });

  // ── risers under raised rows: the stands ─────────────────────────────────
  if (model.risers.length) {
    const risers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: style.riser, roughness: 0.95 }),
      model.risers.length,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    model.risers.forEach((r, i) => {
      q.setFromAxisAngle(up, r.rot);
      m.compose(new THREE.Vector3(r.x, r.h / 2, r.z), q, new THREE.Vector3(r.w, r.h, r.d));
      risers.setMatrixAt(i, m);
    });
    group.add(risers);

    // A thin light along each step's front edge: the aisle lighting every
    // real auditorium has, and what makes the tiers read in a dark room.
    const lips = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.03, 0.03),
      new THREE.MeshBasicMaterial({ color: style.rim, transparent: true, opacity: 0.55 }),
      model.risers.length,
    );
    show.pulse.push({ material: lips.material, base: new THREE.Color(style.rim) });
    model.risers.forEach((r, i) => {
      q.setFromAxisAngle(up, r.rot);
      const fx = -Math.sin(r.rot) * (r.d / 2);
      const fz = -Math.cos(r.rot) * (r.d / 2);
      m.compose(new THREE.Vector3(r.x + fx, r.h + 0.015, r.z + fz), q, new THREE.Vector3(r.w, 1, 1));
      lips.setMatrixAt(i, m);
    });
    group.add(lips);
  }

  // ── table bodies ─────────────────────────────────────────────────────────
  // White, tinted per table: each instance carries its table's colour (the 2D
  // map's, sceneModel `bodyColor`) or the scene's cloth.
  const cloth = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const clothTint = new THREE.Color();
  const round = model.bodies.filter((b) => b.kind === 'ellipse');
  const square = model.bodies.filter((b) => b.kind !== 'ellipse');
  const placeBodies = (list, geometry) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geometry, cloth, list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    list.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rot);
      m.compose(new THREE.Vector3(b.x, 0.37, b.z), q, new THREE.Vector3(b.w, 0.74, b.d));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, clothTint.set(b.color || style.cloth));
    });
    group.add(mesh);
  };
  placeBodies(round, new THREE.CylinderGeometry(0.5, 0.5, 1, 40));
  placeBodies(square, new THREE.BoxGeometry(1, 1, 1));

  // ── zones ────────────────────────────────────────────────────────────────
  const zoneLabels = [];
  for (const z of model.zones) addZone(THREE, group, z, scene, style, title, animated, zoneLabels, show);

  // ── chairs ───────────────────────────────────────────────────────────────
  const { cushion, back, leg } = chairGeometries(THREE, model.seats.length);
  const seatMat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.0 });
  const n = Math.max(1, model.seats.length);
  const seatMesh = new THREE.InstancedMesh(cushion, seatMat, n);
  const backMesh = new THREE.InstancedMesh(back, seatMat, n);
  const legMesh = new THREE.InstancedMesh(leg, new THREE.MeshStandardMaterial({ color: 0x1c2326, roughness: 0.35, metalness: 0.8 }), n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const sized = new THREE.Vector3();
  const white = new THREE.Color(0xffffff);
  model.seats.forEach((s, i) => {
    q.setFromAxisAngle(up, s.yaw);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, s.size ? sized.setScalar(s.size) : one);
    seatMesh.setMatrixAt(i, m);
    backMesh.setMatrixAt(i, m);
    legMesh.setMatrixAt(i, m);
    seatMesh.setColorAt(i, white);
    backMesh.setColorAt(i, white);
  });
  if (!model.seats.length) { seatMesh.count = 0; backMesh.count = 0; legMesh.count = 0; }
  group.add(seatMesh, backMesh, legMesh);

  // Section badges, kept apart so the seat view can hide them: from inside a
  // section, its own name floats in front of the stage.
  const badges = labels.map((l) => {
    const sprite = makeLabel(THREE, l.text, { height: l.height || 0.9 });
    sprite.position.set(l.x, l.y, l.z);
    group.add(sprite);
    return sprite;
  });

  // TABLE NUMBERS (2026-11-19: "when you choose 3D we should see table
  // numbers"). The 2D map names every table; without these the 3D view was a
  // field of identical tables, and "table 12" could not be found in it. One
  // small plate floating over each table, sized to the table, depth-tested so
  // a near table's number is not painted over by a far one's.
  // Off in the editor's small preview, where they crowd the picture.
  const tableNumbers = (withNumbers ? model.bodies : []).filter((b) => b.label).map((b) => {
    const plate = makeLabel(THREE, String(b.label), {
      height: Math.min(0.7, Math.max(0.36, Math.min(b.w, b.d) * 0.32)),
      depthTest: true,
    });
    plate.position.set(b.x, 1.3, b.z);
    group.add(plate);
    return plate;
  });

  // Every label hides in the seat view: from a chair, a name floating in
  // front of the stage is in the way of the thing it names.
  return { group, seatMesh, backMesh, animated, badges: [...badges, ...zoneLabels, ...tableNumbers], style, show };
}

function placeFlat(THREE, mesh, z, y) {
  mesh.position.set(z.x, y, z.z);
  mesh.rotation.y = z.rot;
  return mesh;
}

/**
 * A screen: the picture on a thin LED cabinet. Unlit and not tone-mapped, so
 * its colours are the show's own and the bloom pass makes it glow; a hair
 * under full white, so text on it stays crisp through that glow.
 */
function makeScreen(THREE, show, title, w, h, { doubleSided = false } = {}) {
  const map = show.texture || screenTexture(THREE, title);
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map, toneMapped: false, color: 0xe8e8e8, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide }),
  );
  panel.userData.screen = true;
  const cabinet = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.24, h + 0.24, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.5, metalness: 0.6 }),
  );
  cabinet.position.z = -0.1;
  const rig = new THREE.Group();
  rig.add(cabinet, panel);
  show.screens.push(panel);
  return rig;
}

function addZone(THREE, group, z, scene, style, title, animated, zoneLabels, show) {
  const color = new THREE.Color(z.color || zoneMeta(z.kind).color);
  const label = z.label || zoneMeta(z.kind).label;

  if (z.kind === 'stage') {
    const h = Math.max(0.05, Number(scene.stageHeight) || 0);
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(z.w, h, z.d),
      new THREE.MeshStandardMaterial({ color: 0x142226, roughness: 0.22, metalness: 0.55 }),
    );
    group.add(placeFlat(THREE, deck, z, h / 2));
    addTruss(THREE, group, z, h, style);

    // The back of the stage is the side away from the room's centre.
    const away = Math.hypot(z.x, z.z) || 1;
    const bx = z.x / away;
    const bz = z.z / away;
    const facing = Math.atan2(-bx, -bz);
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(z.w, 0.06, 0.06),
      new THREE.MeshBasicMaterial({ color: style.rim }),
    );
    edge.position.set(z.x - bx * (z.d / 2), h + 0.03, z.z - bz * (z.d / 2));
    edge.rotation.y = facing;
    group.add(edge);

    const truss = h + Math.max(6, z.w * 0.35);
    if (scene.screens) {
      // ALWAYS 16:9 (screenModel.screenSize): as wide as the stage allows
      // and low enough to hang under the truss, scaled by the organizer.
      const { w: sw, h: sh } = screenSize({ room: z.w * 0.8, maxHeight: truss - h - 1.7, size: show.layout.size });
      const screen = makeScreen(THREE, show, title, sw, sh);
      screen.position.set(z.x + bx * (z.d / 2 + 0.2), h + sh / 2 + 1.2, z.z + bz * (z.d / 2 + 0.2));
      // A plane's front faces +z; turned by `facing` it faces the room.
      screen.rotation.y = facing;
      group.add(screen);
      show.anchor = { x: screen.position.x, y: screen.position.y, z: screen.position.z };

      // The light the screen throws on the stage and the front rows, tinted
      // to whatever it is showing (VenueScene3D samples the picture).
      const glow = new THREE.PointLight(0xffffff, 0, Math.max(18, z.w * 2.2), 1.6);
      glow.position.set(screen.position.x - bx * 3, screen.position.y - sh * 0.2, screen.position.z - bz * 3);
      group.add(glow);
      show.glow = glow;

      if (show.layout.sides) {
        // Side screens, angled in toward the room: landscape too, for the
        // seats too far round to read the main one.
        const side = screenSize({ room: sw * 0.36, size: 100, minWidth: 1.4 });
        for (const dir of [-1, 1]) {
          const small = makeScreen(THREE, show, title, side.w, side.h);
          const off = (sw / 2 + side.w * 0.62) * dir;
          small.position.set(
            screen.position.x + Math.cos(facing) * off - bx * 1.2,
            h + 1.2 + Math.max(side.h / 2, sh * 0.55),
            screen.position.z - Math.sin(facing) * off - bz * 1.2,
          );
          small.rotation.y = facing - dir * 0.35;
          group.add(small);
        }
      }
    }

    // Light beams: additive cones from a truss above the stage. Fake
    // volumetrics, but they read as stage lighting at a glance, for free.
    // A concert shows them always; any room shows them in Showtime, when
    // they take the screen's colour and move to the music.
    const always = scene.mood === 'concert';
    for (let i = 0; i < 5; i += 1) {
      const len = truss + 2;
      const base = new THREE.Color(i % 2 ? 0x5fe0d6 : 0x8f7dff);
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(2.2, len, 24, 1, true),
        new THREE.MeshBasicMaterial({
          color: base.clone(), transparent: true, opacity: always ? 0.07 : 0,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      const t = (i / 4 - 0.5) * z.w * 0.8;
      const pivot = new THREE.Group();
      pivot.position.set(z.x + Math.cos(facing) * t, truss, z.z - Math.sin(facing) * t);
      cone.position.y = -len / 2;
      pivot.add(cone);
      pivot.userData.phase = i * 1.3;
      pivot.userData.facing = facing;
      pivot.visible = always;
      group.add(pivot);
      if (always) animated.push(pivot);
      show.beams.push({ pivot, material: cone.material, base, always });
    }

    show.pulse.push(...frameLamps(group));
    const sign = makeLabel(THREE, label.toUpperCase(), { height: 0.7 });
    sign.position.set(z.x, h + 0.6, z.z);
    group.add(sign);
    zoneLabels.push(sign);
    return;
  }

  if (z.kind === 'screen') {
    // A screen the organizer placed on the map. 16:9 along the LONGER side
    // of what they drew: a screen drawn tall on the 2D map turns to face the
    // other way, it never stands on end.
    const long = Math.max(z.w, z.d);
    const { w, h } = screenSize({ room: long, size: 100, minWidth: 1.6 });
    const screen = makeScreen(THREE, show, title, w, h, { doubleSided: true });
    group.add(placeFlat(THREE, screen, z, 2.4 + h / 2));
    if (z.d > z.w) screen.rotation.y += Math.PI / 2;
    if (!show.anchor) show.anchor = { x: z.x, y: 2.4 + h / 2, z: z.z };
    return;
  }

  if (z.kind === 'barrier') {
    const barrier = new THREE.Mesh(
      new THREE.BoxGeometry(z.w, 1.1, Math.min(z.d, 0.35)),
      new THREE.MeshStandardMaterial({ color: 0x9aa4a8, metalness: 0.6, roughness: 0.4 }),
    );
    group.add(placeFlat(THREE, barrier, z, 0.55));
    return;
  }

  const glossy = z.kind === 'dance_floor';
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(z.w, 0.06, z.d),
    new THREE.MeshStandardMaterial({
      color, transparent: true, opacity: z.kind === 'aisle' ? 0.45 : 0.7,
      roughness: glossy ? 0.15 : 0.85, metalness: glossy ? 0.4 : 0,
    }),
  );
  group.add(placeFlat(THREE, slab, z, 0.03));
  if (z.kind !== 'aisle') {
    const tag = makeLabel(THREE, label, { height: 0.5, weight: 600, bg: 'rgba(17,16,24,0.6)' });
    tag.position.set(z.x, 0.6, z.z);
    group.add(tag);
    zoneLabels.push(tag);
  }
}

/** Frees every geometry, material and texture under a group. */
export function disposeTree(object) {
  object.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!mat) continue;
      // The show's texture outlives any one room: VenueScene3D frees it.
      if (!mat.map?.userData?.shared) mat.map?.dispose?.();
      mat.dispose?.();
    }
  });
}

/**
 * A lighting truss over the stage: four posts and a frame, with lamp heads
 * along the front beam. What makes a box on the floor read as a stage.
 */
function addTruss(THREE, group, z, h, style) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a3236, roughness: 0.4, metalness: 0.85 });
  const top = h + Math.max(6, z.w * 0.35);
  const frame = new THREE.Group();
  frame.position.set(z.x, 0, z.z);
  frame.rotation.y = z.rot;
  const hw = z.w / 2;
  const hd = z.d / 2;
  for (const [x, zz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, top, 0.22), metal);
    post.position.set(x, top / 2, zz);
    frame.add(post);
  }
  for (const zz of [-hd, hd]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(z.w + 0.22, 0.26, 0.26), metal);
    beam.position.set(0, top, zz);
    frame.add(beam);
  }
  for (const x of [-hw, hw]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, z.d), metal);
    beam.position.set(x, top, 0);
    frame.add(beam);
  }
  const heads = Math.max(4, Math.round(z.w / 1.6));
  const lamp = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.14, 0.2, 0.32, 12),
    new THREE.MeshBasicMaterial({ color: style.rim }),
    heads * 2,
  );
  const m = new THREE.Matrix4();
  for (let i = 0; i < heads; i += 1) {
    const x = -hw + ((i + 0.5) / heads) * z.w;
    m.makeTranslation(x, top - 0.28, -hd);
    lamp.setMatrixAt(i, m);
    m.makeTranslation(x, top - 0.28, hd);
    lamp.setMatrixAt(heads + i, m);
  }
  lamp.userData.lampHeads = true;
  frame.add(lamp);
  group.add(frame);
}

/** The truss's lamp heads just added, for Showtime to pulse. */
function frameLamps(group) {
  const out = [];
  group.traverse((o) => {
    if (o.userData?.lampHeads && !o.userData.claimed) {
      o.userData.claimed = true;
      out.push({ material: o.material, base: o.material.color.clone() });
    }
  });
  return out;
}
