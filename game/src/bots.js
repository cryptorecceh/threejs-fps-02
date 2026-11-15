// Bot AI: four Viper teammates and five Jackal enemies. Bots walk a hand-placed
// waypoint graph, drift toward their assigned site, patrol, engage on line of sight
// with a reaction delay and aim error, burst-fire, retreat when hurt, plant the
// charge when their site is clear, and defuse when the bomb is down. One module owns
// bot bodies, hit meshes, movement, shooting and the plant/defuse timers; main.js
// owns the round rules and calls the callbacks.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WAYPOINTS, SITES, SPAWNS } from './world.js';
import { moveBody, BODY } from './player.js';

const VIPER_NAMES = ['Rook', 'Fable', 'Ivy', 'Dune'];
const JACKAL_NAMES = ['Ash', 'Bramble', 'Cinder', 'Flint', 'Gravel'];
const BOT_SPEED = 3.6;
const BOT_HEALTH = 100;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;
const ENGAGE_RANGE = 42;
const BURST_MIN = 3;
const BURST_MAX = 5;

function nameSprite(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(16,13,9,0.6)';
  ctx.beginPath();
  ctx.roundRect(28, 12, 200, 40, 8);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 33);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.0, 0.25, 1);
  return sprite;
}

export function createBots(scene, world, hooks) {
  const { raycaster, shootables, onDamage, onPlant, onDefuse, random } = hooks;
  const bots = [];
  const hitMeshes = [];
  const eyeHeight = 1.45;
  const tmpDir = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();

  function buildBot(name, team, index) {
    const color = team === 'viper' ? PALETTE.viper : PALETTE.jackal;
    const group = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.7, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a186'), roughness: 0.8 });

    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.18), dark);
    legL.position.set(-0.11, 0.28, 0);
    const legR = legL.clone();
    legR.position.x = 0.11;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), cloth);
    torso.position.y = 0.95;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skin);
    head.position.y = 1.5;
    head.userData.part = 'head';
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.175, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), cloth);
    helmet.position.y = 1.53;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.62), dark);
    gun.position.set(0.2, 1.05, -0.3);
    group.add(legL, legR, torso, head, helmet, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    const tag = nameSprite(name, color);
    tag.position.y = 2.05;
    group.add(tag);
    scene.add(group);

    const bot = {
      id: `${team}-${index}`,
      name,
      team,
      group,
      torso,
      head,
      tag,
      state: {
        position: group.position,
        velocity: new THREE.Vector3(),
        onGround: true,
        height: BODY.standHeight,
      },
      yaw: 0,
      health: BOT_HEALTH,
      alive: true,
      fall: 0,
      site: null,
      role: 'support',
      waypoint: 0,
      goalWaypoint: 0,
      patrolIndex: 0,
      visibleTarget: null,
      visibleKey: null,
      visibleSince: 0,
      reaction: 0.5,
      burstLeft: 0,
      burstGap: 0,
      pauseLeft: 0,
      strafeDir: 1,
      strafeTimer: 0,
      planting: 0,
      defusing: 0,
      retreat: false,
      lastDamageFrom: null,
      aimError: 0.03,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    return bot;
  }

  for (let i = 0; i < VIPER_NAMES.length; i += 1) bots.push(buildBot(VIPER_NAMES[i], 'viper', i));
  for (let i = 0; i < JACKAL_NAMES.length; i += 1) bots.push(buildBot(JACKAL_NAMES[i], 'jackal', i));

  function resetRound(roundNumber) {
    const siteKeys = ['A', 'B'];
    let carrierPicked = false;
    for (const bot of bots) {
      bot.health = BOT_HEALTH;
      bot.alive = true;
      bot.fall = 0;
      bot.planting = 0;
      bot.defusing = 0;
      bot.retreat = false;
      bot.visibleTarget = null;
      bot.burstLeft = 0;
      bot.pauseLeft = 0;
      bot.group.rotation.set(0, 0, 0);
      bot.group.position.y = 0;
      const spawns = bot.team === 'viper' ? SPAWNS.attackers : SPAWNS.defenders;
      const spawnIndex = bot.team === 'viper'
        ? VIPER_NAMES.indexOf(bot.name)
        : JACKAL_NAMES.indexOf(bot.name);
      const [sx, sz] = spawns[spawnIndex % spawns.length];
      bot.group.position.set(sx + (random() - 0.5), 0, sz + (random() - 0.5));
      bot.state.velocity.set(0, 0, 0);
      bot.yaw = bot.team === 'viper' ? 0 : Math.PI; // attackers face north (-z), defenders face south
      bot.group.rotation.y = bot.yaw;
      bot.waypoint = world.nearestWaypoint(bot.group.position.x, bot.group.position.z);
      if (bot.team === 'viper') {
        bot.site = siteKeys[(spawnIndex + roundNumber) % 2];
        bot.role = !carrierPicked ? 'carrier' : 'support';
        if (bot.role === 'carrier') carrierPicked = true;
        const site = SITES[bot.site];
        bot.goalWaypoint = world.nearestWaypoint(site.center.x, site.center.z);
      } else {
        bot.site = siteKeys[spawnIndex % 2];
        bot.role = 'defender';
        // Patrol the north half: pick a waypoint near their site, drift later.
        const site = SITES[bot.site];
        bot.goalWaypoint = world.nearestWaypoint(site.center.x + (random() - 0.5) * 6, site.center.z + 4 + random() * 4);
      }
      bot.reaction = 0.35 + random() * 0.45;
      bot.aimError = 0.022 + random() * 0.025;
    }
  }

  function hasLineOfSight(from, to) {
    tmpDir.copy(to).sub(from);
    const dist = tmpDir.length();
    if (dist < 0.01) return true;
    tmpDir.normalize();
    raycaster.set(from, tmpDir);
    raycaster.far = dist;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit;
  }

  // Find the closest living enemy the bot can see. Player is passed in as a
  // { position, alive }-shaped object with hit spheres in the shootables list.
  function scan(bot, player, dt, now) {
    let best = null;
    let bestDist = ENGAGE_RANGE;
    const from = tmpTarget.copy(bot.group.position);
    from.y += eyeHeight;
    // Player first.
    if (player.alive) {
      const p = new THREE.Vector3(player.position.x, player.position.y + 1.15, player.position.z);
      const d = from.distanceTo(p);
      if (d < bestDist && hasLineOfSight(from, p)) {
        best = { kind: 'player', position: p, dist: d };
        bestDist = d;
      }
    }
    for (const other of bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const p = new THREE.Vector3(other.group.position.x, other.group.position.y + 1.15, other.group.position.z);
      const d = from.distanceTo(p);
      if (d < bestDist && hasLineOfSight(from, p)) {
        best = { kind: 'bot', bot: other, position: p, dist: d };
        bestDist = d;
      }
    }
    if (best && bot.visibleKey !== (best.kind === 'player' ? 'player' : best.bot.id)) {
      bot.visibleTarget = best;
      bot.visibleKey = best.kind === 'player' ? 'player' : best.bot.id;
      bot.visibleSince = now;
      bot.burstLeft = 0;
      bot.pauseLeft = bot.reaction;
    } else if (best) {
      bot.visibleTarget = best;
    } else {
      bot.visibleTarget = null;
      bot.visibleKey = null;
    }
    return best;
  }

  function shootAt(bot, target, dt) {
    if (bot.pauseLeft > 0) {
      bot.pauseLeft -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
      bot.burstGap = 0;
    }
    bot.burstGap -= dt;
    if (bot.burstGap > 0) return;
    bot.burstGap = 0.11;
    bot.burstLeft -= 1;
    if (bot.burstLeft <= 0) bot.pauseLeft = 0.6 + random() * 0.7;

    const from = new THREE.Vector3(bot.group.position.x, bot.group.position.y + eyeHeight, bot.group.position.z);
    const aim = target.position.clone();
    // Aim error grows with distance; headshots are luck, not aimbot.
    const error = bot.aimError * (0.6 + target.dist / 30);
    aim.x += (random() * 2 - 1) * error * target.dist * 0.4;
    aim.y += (random() * 2 - 1) * error * target.dist * 0.3;
    aim.z += (random() * 2 - 1) * error * target.dist * 0.4;
    tmpDir.copy(aim).sub(from).normalize();
    raycaster.set(from, tmpDir);
    raycaster.far = 80;
    const hit = raycaster.intersectObjects(shootables(), false)[0];
    hooks.onBotShot(bot, from, hit ? hit.point : aim);
    if (!hit) return;
    const obj = hit.object;
    if (obj.userData.bot) {
      const part = obj.userData.part;
      onDamage({ kind: 'bot', bot: obj.userData.bot }, part === 'head' ? 85 : 24, part, bot);
    } else if (obj.userData.kind === 'player') {
      const part = obj.userData.part;
      onDamage({ kind: 'player' }, part === 'head' ? 85 : 24, part, bot);
    } else if (hit.point) {
      hooks.onImpact(hit.point, hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0));
    }
  }

  function pickNextWaypoint(bot, goalIndex) {
    // Greedy: among the current node's edges, take the one closest to the goal.
    const options = world.edges.get(bot.waypoint) ?? [];
    let best = bot.waypoint;
    let bestDist = Infinity;
    const [gx, gz] = WAYPOINTS[goalIndex];
    for (const next of options) {
      const d = Math.hypot(WAYPOINTS[next][0] - gx, WAYPOINTS[next][1] - gz);
      if (d < bestDist) {
        bestDist = d;
        best = next;
      }
    }
    return best;
  }

  function stepBot(bot, dt, now, ctx) {
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.08;
      }
      return;
    }
    const pos = bot.group.position;
    // Bots only fight during combat; in the buy phase they walk to positions.
    const target = ctx.phase === 'combat' ? scan(bot, ctx.player, dt, now) : null;
    if (!target) {
      bot.visibleTarget = null;
      bot.visibleKey = null;
    }
    const bomb = ctx.bomb;

    // Defuse: a defender standing on the planted bomb.
    if (bomb.planted && bot.team === 'jackal') {
      const d = Math.hypot(pos.x - bomb.position.x, pos.z - bomb.position.z);
      if (d < 1.4) {
        bot.defusing += dt;
        if (bot.defusing >= DEFUSE_SECONDS) {
          bot.defusing = 0;
          onDefuse(bot);
        }
        return; // stand still and defuse
      }
      bot.defusing = 0;
    }

    // Plant: the carrier, inside their site, with no enemy close by.
    if (bot.role === 'carrier' && !bomb.planted && ctx.phase === 'combat') {
      const site = SITES[bot.site];
      const inSite = Math.hypot(pos.x - site.center.x, pos.z - site.center.z) <= site.radius;
      if (inSite && !target) {
        bot.planting += dt;
        if (bot.planting >= PLANT_SECONDS) {
          bot.planting = 0;
          onPlant(site, bot);
        }
        return; // stand still and plant
      }
      bot.planting = 0;
    }

    // Choose a goal waypoint.
    let goal = bot.goalWaypoint;
    if (bomb.planted && bot.team === 'jackal') {
      goal = world.nearestWaypoint(bomb.position.x, bomb.position.z);
    } else if (bot.team === 'jackal' && ctx.phase === 'combat' && !target) {
      // Defenders drift between their site and mid when nothing is happening.
      if (Math.hypot(pos.x - WAYPOINTS[goal][0], pos.z - WAYPOINTS[goal][1]) < 1.2) {
        const site = SITES[bot.site];
        goal = world.nearestWaypoint(
          site.center.x + (random() - 0.5) * 10,
          site.center.z + 2 + random() * 6,
        );
        bot.goalWaypoint = goal;
      }
    }

    // Movement: walk the graph toward the goal; strafe while engaging.
    let wishX = 0;
    let wishZ = 0;
    let speed = BOT_SPEED;
    const [wx, wz] = WAYPOINTS[bot.waypoint];
    const distToNode = Math.hypot(wx - pos.x, wz - pos.z);
    if (distToNode < 1.0) {
      bot.waypoint = pickNextWaypoint(bot, goal);
    }
    let moveX = WAYPOINTS[bot.waypoint][0] - pos.x;
    let moveZ = WAYPOINTS[bot.waypoint][1] - pos.z;
    const moveLen = Math.hypot(moveX, moveZ) || 1;
    moveX /= moveLen;
    moveZ /= moveLen;

    if (target) {
      // Face the target, strafe sideways, close in if far, back off if too close.
      const dx = target.position.x - pos.x;
      const dz = target.position.z - pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      bot.yaw = Math.atan2(-dx, -dz);
      bot.strafeTimer -= dt;
      if (bot.strafeTimer <= 0) {
        bot.strafeDir = random() < 0.5 ? -1 : 1;
        bot.strafeTimer = 0.7 + random() * 0.9;
      }
      const px = -dz / dist * bot.strafeDir;
      const pz = dx / dist * bot.strafeDir;
      const approach = dist > 18 ? 0.8 : dist < 6 ? -0.6 : 0;
      wishX = px * 0.8 + (dx / dist) * approach;
      wishZ = pz * 0.8 + (dz / dist) * approach;
      speed = BOT_SPEED * 0.75;
      if (now - bot.visibleSince >= bot.reaction) shootAt(bot, target, dt);
    } else {
      // Walk the graph; face the direction of travel.
      wishX = moveX;
      wishZ = moveZ;
      if (moveLen > 0.2) bot.yaw = Math.atan2(-moveX, -moveZ);
      if (bot.retreat) speed = BOT_SPEED * 1.15;
    }

    const len = Math.hypot(wishX, wishZ);
    if (len > 0.01) {
      wishX /= len;
      wishZ /= len;
    }
    moveBody(bot.state, world.overlaps ?? makeOverlaps(), dt, wishX, wishZ, speed, false);
    bot.group.rotation.y = bot.yaw;
    // Walk bob: legs swing while moving.
    const moving = Math.hypot(bot.state.velocity.x, bot.state.velocity.z);
    bot.group.children[0].rotation.x = Math.sin(now * 9) * 0.5 * Math.min(1, moving / 3);
    bot.group.children[1].rotation.x = -Math.sin(now * 9) * 0.5 * Math.min(1, moving / 3);
  }

  // The world module exposes colliders; build a tester once, lazily.
  let overlapsFn = null;
  function makeOverlaps() {
    if (overlapsFn) return overlapsFn;
    const probe = new THREE.Box3();
    overlapsFn = (x, y, z, height, lift) => {
      probe.min.set(x - BODY.radius, y + lift, z - BODY.radius);
      probe.max.set(x + BODY.radius, y + height - lift, z + BODY.radius);
      for (const c of world.colliders) if (probe.intersectsBox(c)) return c;
      return null;
    };
    return overlapsFn;
  }

  function damage(bot, amount) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health <= 35) bot.retreat = true;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.health = 0;
    bot.fall = 0;
    bot.planting = 0;
    bot.defusing = 0;
    return true;
  }

  return {
    bots,
    hitMeshes,
    resetRound,
    damage,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    step(dt, now, ctx) {
      for (const bot of bots) stepBot(bot, dt, now, ctx);
    },
    stage(bot, x, z, yaw) {
      bot.group.position.set(x, 0, z);
      bot.yaw = yaw;
      bot.group.rotation.set(0, yaw, 0);
      bot.group.position.y = 0;
      bot.fall = 0;
      bot.alive = true;
      bot.health = BOT_HEALTH;
    },
  };
}
