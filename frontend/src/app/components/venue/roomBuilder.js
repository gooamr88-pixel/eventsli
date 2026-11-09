import { zoneMeta } from '../seating/venueZones';

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
export function makeLabel(THREE, text, { bg = 'rgba(8,24,26,0.82)', fg = '#ffffff', height = 1.4, weight = 700 } = {}) {
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
  // No depth test: a label names a place and must not vanish behind the
  // seats it names, which is what made the 2D map's badges worth copying.
  // Tinted just under white so the bloom pass (threshold 0.9) leaves text crisp.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: 0xdedede, depthWrite: false, depthTest: false, transparent: true }));
  sprite.scale.set(height * (canvas.width / canvas.height), height, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** The big screen's picture: a stage-light gradient and the event's name. */
function screenTexture(THREE, title) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 400;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(512, 420, 40, 512, 260, 620);
  g.addColorStop(0, '#7ff5e8');
  g.addColorStop(0.35, '#1aa6a3');
  g.addColorStop(1, '#03181a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 400);
  for (let i = 0; i < 9; i += 1) {
    ctx.strokeStyle = `rgba(160,255,245,${0.05 + (i % 3) * 0.03})`;
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(512, 420);
    ctx.lineTo(i * 128, -40);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  // Shrunk to fit rather than cut: an event's name is the one thing on the screen.
  const name = (title || 'Live').slice(0, 60);
  let size = 72;
  do { ctx.font = `700 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`; size -= 4; } while (size > 28 && ctx.measureText(name).width > 900);
  ctx.fillText(name, 512, 215);
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
export function buildRoom(THREE, model, scene, { title, labels = [] } = {}) {
  const style = MOOD_STYLE[scene.mood] || MOOD_STYLE.concert;
  const group = new THREE.Group();
  const animated = [];
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
    const m = new THREE.Matrix4();
    for (let i = 0; i < bulbs; i += 1) {
      const a = (i / bulbs) * Math.PI * 2;
      m.makeTranslation(Math.cos(a) * (R + 11.2), wallH - 0.4, Math.sin(a) * (R + 11.2));
      lamp.setMatrixAt(i, m);
    }
    group.add(lamp);
  }

  // ── lights ───────────────────────────────────────────────────────────────
  group.add(new THREE.HemisphereLight(style.hemiSky, style.hemiGround, style.hemi));
  group.add(new THREE.AmbientLight(0xffffff, 0.25));
  const sun = new THREE.DirectionalLight(0xffffff, style.sun);
  sun.position.set(R * 0.4, R * 1.2, R * 0.8);
  group.add(sun);

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
  const cloth = new THREE.MeshStandardMaterial({ color: style.cloth, roughness: 0.8 });
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
    });
    group.add(mesh);
  };
  placeBodies(round, new THREE.CylinderGeometry(0.5, 0.5, 1, 40));
  placeBodies(square, new THREE.BoxGeometry(1, 1, 1));

  // ── zones ────────────────────────────────────────────────────────────────
  const zoneLabels = [];
  for (const z of model.zones) addZone(THREE, group, z, scene, style, title, animated, zoneLabels);

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
  const white = new THREE.Color(0xffffff);
  model.seats.forEach((s, i) => {
    q.setFromAxisAngle(up, s.yaw);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, one);
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

  // Every label hides in the seat view: from a chair, a name floating in
  // front of the stage is in the way of the thing it names.
  return { group, seatMesh, backMesh, animated, badges: [...badges, ...zoneLabels], style };
}

function placeFlat(THREE, mesh, z, y) {
  mesh.position.set(z.x, y, z.z);
  mesh.rotation.y = z.rot;
  return mesh;
}

function addZone(THREE, group, z, scene, style, title, animated, zoneLabels) {
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

    if (scene.screens) {
      const tex = screenTexture(THREE, title);
      const sw = z.w * 0.8;
      const sh = sw * 0.39;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: tex }));
      screen.position.set(z.x + bx * (z.d / 2 + 0.2), h + sh / 2 + 1.2, z.z + bz * (z.d / 2 + 0.2));
      // A plane's front faces +z; turned by `facing` it faces the room.
      screen.rotation.y = facing;
      group.add(screen);
      for (const side of [-1, 1]) {
        const small = new THREE.Mesh(new THREE.PlaneGeometry(sw * 0.3, sh * 0.6), new THREE.MeshBasicMaterial({ map: tex }));
        const off = (sw / 2 + sw * 0.22) * side;
        small.position.set(
          screen.position.x + Math.cos(facing) * off - bx * 1.2,
          h + sh * 0.6,
          screen.position.z - Math.sin(facing) * off - bz * 1.2,
        );
        small.rotation.y = facing - side * 0.35;
        group.add(small);
      }
    }

    if (scene.mood === 'concert') {
      // Light beams: additive cones from a truss above the stage. Fake
      // volumetrics, but they read as stage lighting at a glance, for free.
      const truss = h + Math.max(6, z.w * 0.35);
      for (let i = 0; i < 5; i += 1) {
        const len = truss + 2;
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(2.2, len, 24, 1, true),
          new THREE.MeshBasicMaterial({
            color: i % 2 ? 0x5fe0d6 : 0x8f7dff, transparent: true, opacity: 0.07,
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
        group.add(pivot);
        animated.push(pivot);
      }
    }

    const sign = makeLabel(THREE, label.toUpperCase(), { height: 0.7 });
    sign.position.set(z.x, h + 0.6, z.z);
    group.add(sign);
    zoneLabels.push(sign);
    return;
  }

  if (z.kind === 'screen') {
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(z.w, Math.max(1.5, z.w * 0.4)),
      new THREE.MeshBasicMaterial({ map: screenTexture(THREE, title), side: THREE.DoubleSide }),
    );
    group.add(placeFlat(THREE, screen, z, 4 + z.w * 0.2));
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
    const tag = makeLabel(THREE, label, { height: 0.5, weight: 600, bg: 'rgba(8,24,26,0.6)' });
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
      mat.map?.dispose?.();
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
  frame.add(lamp);
  group.add(frame);
}
