// Dustline Yard — boot and the one loop: a fixed 60 Hz simulation feeding a render
// at the display's rate. Round flow: menu → buy → combat → round end → match end.
// Vipers (the player + 4 bots) attack; Jackals (5 bots) defend. A round is won by
// eliminating the enemy team, by the planted charge detonating, or (defenders) by
// the timer running out or a defuse. First to 8 rounds, max 15.
// ?shot=start|buy|play|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapon.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';

const FIXED_STEP = 1 / 60;
const BUY_SECONDS = 15;
const ROUND_SECONDS = 100;
const FUSE_SECONDS = 35;
const PLANT_SECONDS = 3;
const WIN_ROUNDS = 8;
const MAX_ROUNDS = 15;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1400;
const LOSS_STREAK_BONUS = 500;
const LOSS_REWARD_CAP = 3400;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

window.__errors = [];
window.addEventListener('error', (event) => {
  window.__errors.push(String(event.message ?? event.error ?? 'error'));
});

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color('#c9a86a'), 30, 90);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 300);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const effects = createEffects(scene);
const weapon = createWeapon(camera);
const hud = createHud();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

// Invisible hit spheres that follow the player, so bot fire can hit them.
const sphereMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const playerChest = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), sphereMat);
playerChest.userData = { kind: 'player', part: 'torso' };
const playerHead = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), sphereMat);
playerHead.userData = { kind: 'player', part: 'head' };
scene.add(playerChest, playerHead);
const playerSpheres = [playerChest, playerHead];

const stats = new Map();
function statFor(name, team, isPlayer = false) {
  if (!stats.has(name)) stats.set(name, { name, team, kills: 0, deaths: 0, money: 0, isPlayer });
  return stats.get(name);
}
statFor('You', 'viper', true);
for (const n of ['Rook', 'Fable', 'Ivy', 'Dune']) statFor(n, 'viper');
for (const n of ['Ash', 'Bramble', 'Cinder', 'Flint', 'Gravel']) statFor(n, 'jackal');

const shootablesForPlayer = () => world.shootables.concat(bots.hitMeshes);
const shootablesForBots = () => world.shootables.concat(bots.hitMeshes, playerSpheres);

const bots = createBots(scene, world, {
  raycaster,
  shootables: shootablesForBots,
  random,
  onDamage(victim, amount, part, shooter) {
    if (victim.kind === 'player') {
      hurtPlayer(amount, shooter);
    } else {
      const killed = bots.damage(victim.bot, amount);
      if (killed) registerKill(shooter, victim.bot, part === 'head');
    }
  },
  onBotShot(bot, from, to) {
    effects.tracer(from, to);
    audio.shot('vk47');
  },
  onImpact(point, normal) {
    effects.impact(point, normal);
  },
  onPlant(site, bot) {
    plantBomb(site.center.x, site.center.z, bot.name);
  },
  onDefuse(bot) {
    endRound('jackal', `${bot.name} defused the charge`);
  },
});

const body = player.state;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();

let phase = 'menu'; // menu | buy | combat | roundEnd | matchEnd
let paused = false;
let started = false;
let frozen = false;
let elapsed = 0;
let round = 1;
let viperScore = 0;
let jackalScore = 0;
let money = 800;
let lossStreak = 0;
let buyTime = BUY_SECONDS;
let roundTime = ROUND_SECONDS;
let buyOpen = false;
let armorOwned = false;
let prevFiring = false;
let plantProgress = 0;
let plantTickAt = 0;
let roundEndAt = 0;
let roundEndInfo = null;
let matchOver = false;
let accumulator = 0;
let lastTime = performance.now();
let minimapAt = 0;

const bomb = {
  planted: false,
  site: null,
  position: new THREE.Vector3(),
  fuse: FUSE_SECONDS,
  mesh: null,
  light: null,
  beepAt: 0,
};

function makeBombMesh() {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.25, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.4 }),
  );
  box.position.y = 0.13;
  const light = new THREE.PointLight(new THREE.Color('#ff3b30'), 0, 6);
  light.position.y = 0.5;
  group.add(box, light);
  group.visible = false;
  scene.add(group);
  return { group, light };
}
bomb.mesh = makeBombMesh();

function feed(killerName, killerTeam, victimName, victimTeam, headshot) {
  const kc = killerTeam === 'viper' ? 'v' : 'j';
  const vc = victimTeam === 'viper' ? 'v' : 'j';
  hud.killfeed(`<span class="${kc}">${killerName}</span> ✕ <span class="${vc}">${victimName}</span>${headshot ? ' <span class="hs">HEADSHOT</span>' : ''}`);
}

function registerKill(shooter, victimBot, headshot) {
  const killerName = shooter === 'player' ? 'You' : shooter.name;
  const killerTeam = shooter === 'player' ? 'viper' : shooter.team;
  statFor(killerName, killerTeam, shooter === 'player').kills += 1;
  statFor(victimBot.name, victimBot.team).deaths += 1;
  feed(killerName, killerTeam, victimBot.name, victimBot.team, headshot);
  if (shooter === 'player') {
    money += KILL_REWARD;
    audio.kill();
  }
}

function hurtPlayer(amount, shooter) {
  if (phase !== 'combat' || body.health <= 0) return;
  const died = player.damage(amount);
  hud.damageFlash();
  audio.hurt();
  if (died) {
    statFor('You', 'viper', true).deaths += 1;
    const killerName = shooter ? shooter.name : 'Jackals';
    feed(killerName, 'jackal', 'You', 'viper', false);
    if (shooter) statFor(shooter.name, 'jackal').kills += 1;
    hud.banner('You are down', 'Your team fights on — watch the round play out');
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function plantBomb(x, z, byName) {
  if (bomb.planted || phase !== 'combat') return;
  bomb.planted = true;
  bomb.position.set(x, 0, z);
  bomb.fuse = FUSE_SECONDS;
  bomb.mesh.group.position.set(x, 0, z);
  bomb.mesh.group.visible = true;
  bomb.beepAt = 0;
  hud.banner('Charge planted', `${byName} planted the charge — defend it`);
  audio.planted();
}

function scoreboardRows() {
  return [...stats.values()].map((s) => ({
    ...s,
    money: s.isPlayer ? money : 0,
  }));
}

function endRound(winner, reason) {
  if (phase !== 'combat' && phase !== 'buy') return;
  phase = 'roundEnd';
  if (bomb.planted) {
    bomb.mesh.group.visible = false;
    bomb.planted = false;
  }
  const vipersWon = winner === 'viper';
  if (vipersWon) {
    viperScore += 1;
    money += WIN_REWARD;
    lossStreak = 0;
    audio.roundWin();
  } else {
    jackalScore += 1;
    money += Math.min(LOSS_REWARD_CAP, LOSS_REWARD + LOSS_STREAK_BONUS * lossStreak);
    lossStreak += 1;
    audio.roundLose();
  }
  hud.setMoney(money);
  hud.showBuy(false);
  buyOpen = false;
  hud.setPlant(null);
  hud.hint(null);
  roundEndInfo = { winner, reason };
  roundEndAt = elapsed + 2.8;
  hud.banner(
    vipersWon ? 'Round to Vipers' : 'Round to Jackals',
    `${reason} — Vipers ${viperScore} : ${jackalScore} Jackals`,
    2800,
  );
  if (document.pointerLockElement) document.exitPointerLock();
}

function showRoundEndOverlay() {
  const vipersWon = roundEndInfo.winner === 'viper';
  const matchDone = viperScore >= WIN_ROUNDS || jackalScore >= WIN_ROUNDS || round >= MAX_ROUNDS;
  if (matchDone) {
    phase = 'matchEnd';
    matchOver = true;
    const title = viperScore > jackalScore
      ? 'Vipers take the match'
      : jackalScore > viperScore ? 'Jackals take the match' : 'Match drawn';
    hud.showOverlay('matchEnd', {
      title,
      copy: `Final score — Vipers ${viperScore} : ${jackalScore} Jackals. ${roundEndInfo.reason}.`,
      rows: scoreboardRows(),
      viperScore,
      jackalScore,
    });
    return;
  }
  hud.showOverlay('roundEnd', {
    title: vipersWon ? 'Round to Vipers' : 'Round to Jackals',
    copy: `${roundEndInfo.reason}. Next round starts with a buy phase.`,
    rows: scoreboardRows(),
    viperScore,
    jackalScore,
  });
}

function startRound() {
  round = Math.min(round, MAX_ROUNDS);
  const spawnIndex = 2; // player spawns centre-south, a step behind the bots
  const [sx, sz] = [0, 18.3];
  const survived = body.health > 0;
  player.reset(sx, sz, 0);
  if (!survived) {
    player.state.armor = 0;
    armorOwned = false;
  }
  weapon.refill();
  weapon.select('p9');
  if (weapon.owned.vk47) weapon.select('vk47');
  else if (weapon.owned.longshot) weapon.select('longshot');
  bots.resetRound(round);
  bomb.planted = false;
  bomb.mesh.group.visible = false;
  plantProgress = 0;
  buyTime = BUY_SECONDS;
  roundTime = ROUND_SECONDS;
  phase = 'buy';
  buyOpen = true;
  hud.showBuy(true, money, { ...weapon.owned, armor: armorOwned });
  hud.setMoney(money);
  hud.setTop(round, viperScore, jackalScore, buyTime, null);
  hud.hint('Buy phase — press B for the shop, click the canvas to aim');
  hud.banner(`Round ${round}`, 'Buy your gear — combat starts soon', 2000);
}

function startCombat() {
  phase = 'combat';
  roundTime = ROUND_SECONDS;
  buyOpen = false;
  hud.showBuy(false);
  hud.hint(null);
  hud.banner(`Round ${round}`, 'Go — plant the charge or clear the Jackals', 1800);
}

function startMatch() {
  stats.clear();
  statFor('You', 'viper', true);
  for (const n of ['Rook', 'Fable', 'Ivy', 'Dune']) statFor(n, 'viper');
  for (const n of ['Ash', 'Bramble', 'Cinder', 'Flint', 'Gravel']) statFor(n, 'jackal');
  round = 1;
  viperScore = 0;
  jackalScore = 0;
  money = 800;
  lossStreak = 0;
  matchOver = false;
  weapon.owned.vk47 = false;
  weapon.owned.longshot = false;
  armorOwned = false;
  startRound();
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (phase === 'menu') {
    started = true;
    startMatch();
    hud.hideOverlay();
    input.requestLock();
  } else if (phase === 'roundEnd') {
    round += 1;
    startRound();
    hud.hideOverlay();
  } else if (phase === 'matchEnd') {
    startMatch();
    hud.hideOverlay();
    input.requestLock();
  } else if (paused) {
    paused = false;
    hud.hideOverlay();
    input.requestLock();
  }
});

hud.onBuy((id) => {
  if (phase !== 'buy') return;
  tryBuy(id);
});

function tryBuy(id) {
  if (id === 'armor') {
    if (armorOwned || money < 650) {
      audio.denied();
      return;
    }
    money -= 650;
    player.state.armor = 100;
    armorOwned = true;
    audio.buy();
  } else {
    const def = WEAPONS[id];
    if (!def) return;
    if (weapon.owned[id]) {
      weapon.select(id);
      audio.buy();
    } else if (money < def.price) {
      audio.denied();
      return;
    } else {
      money -= def.price;
      weapon.buy(id);
      weapon.select(id);
      audio.buy();
    }
  }
  hud.setMoney(money);
  hud.showBuy(true, money, { ...weapon.owned, armor: armorOwned });
  const ammo = weapon.ammo();
  hud.setAmmo(ammo.mag, ammo.reserve, weapon.def().name);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    if (phase === 'combat' || phase === 'buy') hud.hideOverlay();
    paused = false;
  } else if (phase === 'combat' && body.health > 0 && started && !matchOver) {
    paused = true;
    hud.showOverlay('paused');
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  if (!weapon.takeRound()) {
    audio.dryClick();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  muzzle.copy(camera.position).addScaledVector(direction, 0.6);
  muzzle.y -= 0.12;
  const hit = raycaster.intersectObjects(shootablesForPlayer(), false)[0];
  const end = hit ? hit.point : camera.position.clone().addScaledVector(direction, 60);
  effects.tracer(muzzle, end);
  audio.shot(weapon.state.weaponId);
  if (hit) {
    if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const part = hit.object.userData.part;
      const def = weapon.def();
      const killed = bots.damage(bot, part === 'head' ? def.headDamage : def.damage);
      hud.hitMarker(killed, shot ? 4000 : 120);
      audio.hit();
      if (killed) registerKill('player', bot, part === 'head');
    } else {
      const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      effects.impact(hit.point, normal);
    }
  }
  weapon.pullTrigger();
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  const ammo = weapon.ammo();
  hud.setAmmo(ammo.mag, ammo.reserve, weapon.def().name);
  return true;
}

function botContext() {
  return {
    phase: phase === 'combat' ? 'combat' : 'idle',
    player: { position: body.position, alive: body.health > 0 },
    bomb: { planted: bomb.planted, position: bomb.position },
  };
}

function step(dt) {
  elapsed += dt;

  // Timers and phase transitions.
  if (phase === 'buy') {
    buyTime -= dt;
    hud.setTop(round, viperScore, jackalScore, buyTime, null);
    if (buyTime <= 0) startCombat();
  } else if (phase === 'combat') {
    roundTime -= dt;
    if (bomb.planted) {
      bomb.fuse -= dt;
      bomb.beepAt -= dt;
      if (bomb.beepAt <= 0) {
        bomb.beepAt = 1;
        bomb.mesh.light.intensity = 14;
        audio.plantTick();
      } else {
        bomb.mesh.light.intensity = Math.max(0, bomb.mesh.light.intensity - dt * 20);
      }
      hud.setTop(round, viperScore, jackalScore, roundTime, bomb.fuse);
      if (bomb.fuse <= 0) {
        audio.explosion();
        endRound('viper', 'The charge detonated');
      }
    } else {
      hud.setTop(round, viperScore, jackalScore, roundTime, null);
      if (roundTime <= 0) endRound('jackal', 'Time expired with no plant');
    }
  } else if (phase === 'roundEnd' && elapsed >= roundEndAt) {
    showRoundEndOverlay();
    roundEndAt = Infinity;
  }

  const alive = body.health > 0;
  const canAct = (phase === 'buy' || phase === 'combat') && alive && !paused;

  if (canAct) {
    // Look (slower when scoped).
    const look = input.takeLook();
    const sens = weapon.state.scoped ? 0.0009 : 0.0022;
    player.look(look.x * (sens / 0.0022), look.y * (sens / 0.0022));
    player.step(dt, input.state.keys);

    // Scope: right mouse with the DMR. FOV always eases back when not scoped.
    const wantScope = input.state.scoped && weapon.def().scoped;
    weapon.setScoped(wantScope);
    hud.setScoped(wantScope);
    const targetFov = wantScope ? 28 : 74;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
    camera.updateProjectionMatrix();

    // Fire: full-auto holds, semi-auto fires on the press edge.
    const def = weapon.def();
    if (def.auto) {
      if (input.state.firing && weapon.ready()) shoot(shot ? 0 : weapon.spread(player.groundSpeed()));
    } else if (input.state.firing && !prevFiring && weapon.ready()) {
      shoot(shot ? 0 : weapon.spread(player.groundSpeed()));
    }
    prevFiring = input.state.firing;

    // Reload, weapon switch, buy toggle.
    if (input.takePressed('KeyR')) {
      weapon.reload();
      audio.reload();
    }
    if (phase === 'buy') {
      if (input.takePressed('KeyB')) {
        buyOpen = !buyOpen;
        hud.showBuy(buyOpen, money, { ...weapon.owned, armor: armorOwned });
      }
      if (buyOpen) {
        if (input.takePressed('Digit1')) tryBuy('vk47');
        if (input.takePressed('Digit2')) tryBuy('longshot');
        if (input.takePressed('Digit3')) tryBuy('armor');
        if (input.takePressed('Digit4')) tryBuy('p9');
      } else {
        if (input.takePressed('Digit1')) weapon.select('p9');
        if (input.takePressed('Digit2')) weapon.select('vk47');
        if (input.takePressed('Digit3')) weapon.select('longshot');
      }
    } else if (phase === 'combat') {
      if (input.takePressed('Digit1')) weapon.select('p9');
      if (input.takePressed('Digit2')) weapon.select('vk47');
      if (input.takePressed('Digit3')) weapon.select('longshot');
    }

    // Plant: hold E inside a site while the bomb is not down.
    if (phase === 'combat' && !bomb.planted) {
      const site = world.pointInSite(body.position.x, body.position.z);
      if (site && input.state.keys.has('KeyE')) {
        plantProgress += dt;
        plantTickAt -= dt;
        if (plantTickAt <= 0) {
          plantTickAt = 0.5;
          audio.plantTick();
        }
        hud.setPlant(plantProgress / PLANT_SECONDS);
        hud.hint(`Planting the charge at site ${site.name}…`);
        if (plantProgress >= PLANT_SECONDS) {
          plantProgress = 0;
          hud.setPlant(null);
          plantBomb(body.position.x, body.position.z, 'You');
        }
      } else {
        if (plantProgress > 0) hud.setPlant(null);
        plantProgress = 0;
        if (site) hud.hint(`Hold E to plant the charge at site ${site.name}`);
        else hud.hint(null);
      }
    }
  } else {
    input.takeLook();
    input.clearPressed();
  }

  // Bots fight whenever the round is live; they idle in buy/menu phases.
  if (phase === 'buy' || phase === 'combat') {
    bots.step(dt, elapsed, botContext());
  }
  weapon.step(dt);
  effects.step(dt);

  // Player hit spheres follow the body.
  playerChest.position.set(body.position.x, body.position.y + 1.1, body.position.z);
  playerHead.position.set(body.position.x, body.position.y + 1.5, body.position.z);

  // HUD readouts.
  const ammo = weapon.ammo();
  hud.setAmmo(ammo.mag, ammo.reserve, weapon.def().name);
  hud.setHealth(body.health, body.armor);
  hud.setMoney(money);
  const spreadPx = 3 + weapon.spread(player.groundSpeed()) * 420;
  hud.setCrosshair(Math.min(26, spreadPx));
  minimapAt -= dt;
  if (minimapAt <= 0) {
    minimapAt = 0.15;
    hud.drawMinimap(body.position, body.yaw, bots.bots, bomb.planted ? bomb : null, Object.values(SITES));
  }

  // Round decided by elimination.
  if (phase === 'combat') {
    if (bots.aliveCount('jackal') === 0) endRound('viper', 'Jackal team eliminated');
    else if (bots.aliveCount('viper') === 0 && body.health <= 0) endRound('jackal', 'Viper team eliminated');
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen && !paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  // A live round, staged deterministically.
  startMatch();
  if (name === 'start') {
    body.position.set(0, 0, 18.3);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 2.5, -12));
    hud.showBuy(false);
    hud.hint(null);
    hud.showOverlay('start');
    hud.setTop(1, 0, 0, BUY_SECONDS, null);
  } else if (name === 'buy') {
    body.position.set(0, 0, 18.3);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 2.5, -12));
    hud.showBuy(true, money, { ...weapon.owned, armor: armorOwned });
    hud.setTop(1, 0, 0, BUY_SECONDS, null);
  } else if (name === 'play') {
    startCombat();
    settle(16);
    // Stage: an enemy in the open down mid-lane, a teammate beside the player.
    // Staged after settling so the bots hold these exact spots for the frame.
    // The enemy stands south of the central container block, in the open, so the
    // shots land on open ground and the body stays visible after the kill.
    const jackal = bots.bots.find((b) => b.team === 'jackal');
    bots.stage(jackal, 1.5, 2, Math.PI);
    const viper = bots.bots.find((b) => b.team === 'viper' && b.name === 'Rook');
    bots.stage(viper, -4, 10, 0.4);
    body.position.set(0, 0, 14);
    weapon.buy('vk47');
    weapon.select('vk47');
    money = 2450;
    aimAt(new THREE.Vector3(jackal.group.position.x, 1.2, jackal.group.position.z));
    for (let i = 0; i < 3; i += 1) {
      shoot(0);
      settle(2);
    }
    // One last shot right before the freeze so the tracer and muzzle flash are
    // fresh in the captured frame.
    aimAt(new THREE.Vector3(jackal.group.position.x, 1.2, jackal.group.position.z));
    shoot(0);
    hud.setTop(3, 2, 1, 87, null);
  } else if (name === 'end') {
    viperScore = 8;
    jackalScore = 5;
    round = 13;
    statFor('You', 'viper', true).kills = 21;
    statFor('You', 'viper', true).deaths = 9;
    statFor('Rook', 'viper').kills = 14;
    statFor('Rook', 'viper').deaths = 11;
    statFor('Fable', 'viper').kills = 11;
    statFor('Fable', 'viper').deaths = 12;
    statFor('Ivy', 'viper').kills = 9;
    statFor('Ivy', 'viper').deaths = 10;
    statFor('Dune', 'viper').kills = 12;
    statFor('Dune', 'viper').deaths = 8;
    statFor('Ash', 'jackal').kills = 16;
    statFor('Ash', 'jackal').deaths = 13;
    statFor('Bramble', 'jackal').kills = 13;
    statFor('Bramble', 'jackal').deaths = 12;
    statFor('Cinder', 'jackal').kills = 10;
    statFor('Cinder', 'jackal').deaths = 14;
    statFor('Flint', 'jackal').kills = 8;
    statFor('Flint', 'jackal').deaths = 11;
    statFor('Gravel', 'jackal').kills = 7;
    statFor('Gravel', 'jackal').deaths = 9;
    money = 12450;
    settle(20);
    body.position.set(0, 0, 18.3);
    aimAt(new THREE.Vector3(0, 2.5, -12));
    hud.showBuy(false);
    hud.hint(null);
    hud.setTop(13, 8, 5, 0, null);
    hud.showOverlay('matchEnd', {
      title: 'Vipers take the match',
      copy: 'Final score — Vipers 8 : 5 Jackals. The charge detonated on site B.',
      rows: scoreboardRows(),
      viperScore,
      jackalScore,
    });
  }
  const ammo = weapon.ammo();
  hud.setAmmo(ammo.mag, ammo.reserve, weapon.def().name);
  hud.setHealth(body.health, body.armor);
  hud.setMoney(money);
  hud.hideBanner();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) {
  // Deterministic staged capture: no pointer lock, no user input.
  runShot(shot);
} else {
  hud.setAmmo(weapon.ammo().mag, weapon.ammo().reserve, weapon.def().name);
  hud.setHealth(100, 0);
  hud.setMoney(money);
  hud.setTop(1, 0, 0, BUY_SECONDS, null);
  requestAnimationFrame(frame);
}
