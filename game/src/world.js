// Dustline Yard: a 46 x 38 m desert freight yard. Attackers (Vipers) spawn south,
// defenders (Jackals) north. Site A sits north-west, Site B north-east, a mid lane
// runs down the middle and flank lanes hug both edges. Every box is a collider for
// players and bots and a surface a bullet stops on. All art is procedural.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const YARD = { halfX: 23, halfZ: 19, wallHeight: 5 };
export const SITES = {
  A: { name: 'A', center: new THREE.Vector3(-16, 0, -12), radius: 4.5 },
  B: { name: 'B', center: new THREE.Vector3(16, 0, -12), radius: 4.5 },
};
export const SPAWNS = {
  attackers: [
    [-8, 15.5], [-4, 16], [2.5, 16], [5, 16], [8, 15.5],
  ],
  defenders: [
    [-18, -15.5], [-8, -16], [0, -16.5], [8, -16], [18, -15.5],
  ],
};

// Waypoint graph the bots walk on: hand-placed nodes on open ground, edges joined
// at build time when the straight line between two nodes stays out of cover.
export const WAYPOINTS = [
  [0, 16], [-8, 14], [8, 14], [-16, 12], [16, 12], [-20, 6], [20, 6],
  [-10, 8], [10, 8], [0, 8], [-4, 2], [4, 2], [0, -2], [-12, 0], [12, 0],
  [-20, -4], [20, -4], [-8, -6], [8, -6], [0, -8], [-16, -12], [16, -12],
  [-10, -14], [10, -14], [0, -15], [-20, -12], [20, -12],
];

function sandTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PALETTE.sand;
  ctx.fillRect(0, 0, 512, 512);
  // Speckle.
  for (let i = 0; i < 9000; i += 1) {
    const shade = Math.random();
    ctx.fillStyle = shade < 0.5 ? 'rgba(60,40,20,0.10)' : 'rgba(255,240,200,0.08)';
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // Lane wear: darker wheel ruts down the middle and the two flanks.
  ctx.fillStyle = 'rgba(70,48,24,0.16)';
  for (const x of [128, 256, 384]) {
    ctx.fillRect(x - 26, 0, 52, 512);
    ctx.fillRect(x - 6, 0, 12, 512);
  }
  // Scattered darker patches.
  for (let i = 0; i < 40; i += 1) {
    ctx.fillStyle = 'rgba(80,55,28,0.07)';
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 512, 12 + Math.random() * 30, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 5);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function letterSprite(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(20,16,10,0.55)';
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 84px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.4, 2.4, 1);
  return sprite;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mat = {};
  for (const name of Object.keys(PALETTE)) {
    mat[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'steel' ? 0.55 : 0.92,
      metalness: name === 'steel' ? 0.45 : 0.03,
    });
  }
  // Container paint: rust red and steel blue variants.
  const containerMats = [
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.7, metalness: 0.25 }),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.6, metalness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#6b5a33'), roughness: 0.75, metalness: 0.2 }),
  ];

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, containerMat = null) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), containerMat ?? mat[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function container(x, z, alongX, stacked = false) {
    // A 6 m shipping container, 2.6 m tall, 2.4 m wide.
    const w = alongX ? 6 : 2.4;
    const d = alongX ? 2.4 : 6;
    const m = containerMats[Math.abs(Math.round(x + z)) % containerMats.length];
    box(w, 2.6, d, x, 1.3, z, 'rust', m);
    if (stacked) box(w, 2.6, d, x, 3.9, z, 'rust', containerMats[(Math.abs(Math.round(x * 2 + z)) + 1) % containerMats.length]);
  }

  // Ground: procedural sand.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(YARD.halfX * 2 + 8, YARD.halfZ * 2 + 8),
    new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  // The floor is walkable, not a bullet stopper: add a flat collider at y=0.
  colliders.push(new THREE.Box3(new THREE.Vector3(-40, -0.4, -40), new THREE.Vector3(40, 0, 40)));

  // Perimeter walls.
  box(YARD.halfX * 2 + 0.8, YARD.wallHeight, 0.8, 0, YARD.wallHeight / 2, -YARD.halfZ - 0.4, 'surface');
  box(YARD.halfX * 2 + 0.8, YARD.wallHeight, 0.8, 0, YARD.wallHeight / 2, YARD.halfZ + 0.4, 'surface');
  box(0.8, YARD.wallHeight, YARD.halfZ * 2 + 0.8, -YARD.halfX - 0.4, YARD.wallHeight / 2, 0, 'surface');
  box(0.8, YARD.wallHeight, YARD.halfZ * 2 + 0.8, YARD.halfX + 0.4, YARD.wallHeight / 2, 0, 'surface');

  // Central container block: the mid-lane fight happens around it.
  container(0, -2, true, true);
  container(-6.5, 2.5, false);
  container(6.5, 2.5, false);

  // Mid-lane crates and pillars.
  box(1.3, 1.1, 1.3, -3.4, 0.55, 8, 'hairline');
  box(1.3, 1.1, 1.3, 3.4, 0.55, 8, 'hairline');
  box(1.3, 1.1, 1.3, -3.4, 0.55, -7, 'hairline');
  box(1.3, 1.1, 1.3, 3.4, 0.55, -7, 'hairline');
  box(1.2, 3.4, 1.2, -9, 1.7, -4, 'steel');
  box(1.2, 3.4, 1.2, 9, 1.7, -4, 'steel');

  // Flank lanes: container walls with gaps to peek through.
  container(-19, 6, false);
  container(-19, -5, false, true);
  container(19, 6, false, true);
  container(19, -5, false);
  box(2.2, 1.0, 1.2, -14, 0.5, 6, 'hairline');
  box(2.2, 1.0, 1.2, 14, 0.5, 6, 'hairline');

  // Attacker-side cover near spawn, off the centre lane so the spawn view is open.
  box(2.4, 1.0, 1.2, -6, 0.5, 12, 'hairline');
  box(2.4, 1.0, 1.2, 6, 0.5, 12, 'hairline');
  container(14, 14.5, true);

  // Site compounds: low walls with two entrances each.
  function siteCompound(cx, cz) {
    // Back wall + two side walls, leaving a front gap and a side gap.
    box(9, 1.25, 0.6, cx, 0.62, cz - 3.4, 'surface');
    box(0.6, 1.25, 4.2, cx - 4.5, 0.62, cz - 1.2, 'surface');
    box(0.6, 1.25, 2.4, cx + 4.5, 0.62, cz - 2.1, 'surface');
    box(1.4, 1.1, 1.4, cx + 2.6, 0.55, cz + 1.6, 'hairline');
  }
  siteCompound(-16, -12);
  siteCompound(16, -12);

  // Bombsites: glowing ring + disc + floating letter.
  for (const site of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.35, site.radius, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.center.x, 0.03, site.center.z);
    group.add(ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(site.radius - 0.4, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.08, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(site.center.x, 0.025, site.center.z);
    group.add(disc);
    const letter = letterSprite(site.name, PALETTE.accent);
    letter.position.set(site.center.x, 3.4, site.center.z);
    group.add(letter);
  }

  // Skyline silhouettes outside the walls: distant warehouse blocks.
  const skylineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#241c12') });
  const skyline = [
    [-34, 7, -26, 10, 9, 8], [30, 9, -30, 12, 12, 8], [0, 8, -34, 14, 10, 8],
    [-36, 6, 10, 8, 8, 10], [36, 8, 14, 10, 11, 8], [-30, 5, 28, 12, 6, 8],
    [28, 6, 30, 10, 7, 8], [0, 5, 34, 16, 6, 8],
  ];
  for (const [x, h, z, w, hh, d] of skyline) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), skylineMat);
    m.position.set(x, hh / 2, z);
    group.add(m);
  }

  // Sky: gradient dome + sun disc.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4;
  skyCanvas.height = 256;
  const sctx = skyCanvas.getContext('2d');
  const grad = sctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#2e4a6b');
  grad.addColorStop(0.45, '#7d94a8');
  grad.addColorStop(0.62, '#e8b06a');
  grad.addColorStop(0.75, '#d98a3d');
  grad.addColorStop(1, '#c9a86a');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(160, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  scene.add(dome);
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(9, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe9b0'), fog: false }),
  );
  sun.position.set(60, 55, -110);
  sun.lookAt(0, 0, 0);
  scene.add(sun);

  // Light: warm low sun key with shadows, cool fill, warm sky/ground gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color('#e8b06a'), new THREE.Color(PALETTE.sand), 0.9);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 2.4);
  key.position.set(28, 26, 18);
  key.target.position.set(0, 0, -2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -30;
  key.shadow.camera.far = 90;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7d94a8'), 0.5);
  fill.position.set(-20, 14, 22);
  scene.add(fill);

  // Waypoint edges: join nodes within 12 m when the midpoint is not inside cover.
  const probe = new THREE.Box3();
  function blockedAt(x, z) {
    probe.min.set(x - 0.4, 0.1, z - 0.4);
    probe.max.set(x + 0.4, 1.6, z + 0.4);
    for (const c of colliders) {
      if (c.min.y > 1.6) continue;
      if (probe.intersectsBox(c)) return true;
    }
    return false;
  }
  const edges = new Map();
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    edges.set(i, []);
    for (let j = 0; j < WAYPOINTS.length; j += 1) {
      if (i === j) continue;
      const [ax, az] = WAYPOINTS[i];
      const [bx, bz] = WAYPOINTS[j];
      const dist = Math.hypot(bx - ax, bz - az);
      if (dist > 12 || dist < 0.1) continue;
      if (blockedAt((ax + bx) / 2, (az + bz) / 2)) continue;
      edges.get(i).push(j);
    }
  }

  function nearestWaypoint(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < WAYPOINTS.length; i += 1) {
      const d = Math.hypot(WAYPOINTS[i][0] - x, WAYPOINTS[i][1] - z);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  function pointInSite(x, z) {
    for (const site of Object.values(SITES)) {
      if (Math.hypot(x - site.center.x, z - site.center.z) <= site.radius) return site;
    }
    return null;
  }

  return { colliders, shootables, group, edges, nearestWaypoint, pointInSite };
}
