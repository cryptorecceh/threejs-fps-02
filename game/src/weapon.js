// Three weapons in one view-model slot: P9 sidearm, VK-47 rifle, Longshot DMR.
// The weapon owns its numbers and its model; main.js owns the ray and the damage.
// Spread grows with movement speed, so standing still and tapping beats spraying.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 0, damage: 26, headDamage: 100,
    mag: 12, reserve: 48, gap: 0.16, reloadTime: 1.2, auto: false,
    spreadStill: 0.004, spreadMoving: 0.03, kick: 0.03, flash: 0.05,
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Rifle', price: 2700, damage: 34, headDamage: 136,
    mag: 30, reserve: 90, gap: 0.096, reloadTime: 1.9, auto: true,
    spreadStill: 0.0022, spreadMoving: 0.028, kick: 0.055, flash: 0.06,
  },
  longshot: {
    id: 'longshot', name: 'Longshot DMR', price: 4750, damage: 95, headDamage: 200,
    mag: 5, reserve: 20, gap: 1.15, reloadTime: 2.6, auto: false, scoped: true,
    spreadStill: 0.0008, spreadMoving: 0.045, kick: 0.11, flash: 0.09,
  },
};
const MOVE_REFERENCE = 5.2;

function buildModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.3 });
  const model = new THREE.Group();
  if (def.id === 'p9') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.24), body);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.07), grip);
    handle.position.set(0, -0.07, 0.08);
    model.add(slide, handle);
    model.position.set(0.21, -0.2, -0.42);
    model.scale.setScalar(0.7);
  } else if (def.id === 'vk47') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
    barrel.position.set(0, 0.025, -0.38);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1), dark);
    mag.position.set(0, -0.1, -0.02);
    mag.rotation.x = 0.25;
    model.add(receiver, barrel, stock, mag);
    model.position.set(0.24, -0.2, -0.42);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.55), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.55), dark);
    barrel.position.set(0, 0.02, -0.5);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12), dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.08, -0.05);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.24), grip);
    stock.position.set(0, -0.02, 0.34);
    const bipod = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.02), grip);
    bipod.position.set(0, -0.07, -0.42);
    model.add(receiver, barrel, scope, stock, bipod);
    model.position.set(0.22, -0.19, -0.45);
  }
  return model;
}

export function createWeapon(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    models[def.id] = buildModel(def);
    models[def.id].visible = false;
    camera.add(models[def.id]);
  }

  // Muzzle flash is a point light only: a flash plane reads as a floating diamond
  // in a still frame, while the light plus the tracer carry the effect in motion.
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const owned = { p9: true, vk47: false, longshot: false };
  const ammo = {};
  for (const def of Object.values(WEAPONS)) ammo[def.id] = { mag: def.mag, reserve: def.reserve };

  const state = {
    weaponId: 'p9', cooldown: 0, reloadLeft: 0, flash: 0, kick: 0,
    scoped: false,
  };
  let current = WEAPONS.p9;
  models.p9.visible = true;

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.weaponId];
    model.position.z = (state.weaponId === 'p9' ? -0.44 : state.weaponId === 'vk47' ? -0.42 : -0.45) + state.kick;
    model.rotation.x = state.kick * 2.2;
    model.visible = !(state.scoped && state.weaponId === 'longshot');
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (current.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const slot = ammo[state.weaponId];
        const need = current.mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
  }

  return {
    state,
    def() { return current; },
    owned,
    select(id) {
      if (!owned[id] || id === state.weaponId) return false;
      models[state.weaponId].visible = false;
      state.weaponId = id;
      current = WEAPONS[id];
      models[id].visible = true;
      state.cooldown = Math.max(state.cooldown, 0.25);
      state.reloadLeft = 0;
      state.scoped = false;
      return true;
    },
    buy(id) {
      if (owned[id]) return false;
      owned[id] = true;
      return true;
    },
    step,
    ready() {
      const slot = ammo[state.weaponId];
      return slot.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = current.gap;
      state.flash = current.flash;
      state.kick = current.kick;
    },
    takeRound() {
      const slot = ammo[state.weaponId];
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    reload() {
      const slot = ammo[state.weaponId];
      if (state.reloadLeft > 0 || slot.mag === current.mag || slot.reserve === 0) return;
      state.reloadLeft = current.reloadTime;
    },
    spread(speed) {
      return current.spreadStill + Math.min(1, speed / MOVE_REFERENCE) * current.spreadMoving;
    },
    refill() {
      for (const def of Object.values(WEAPONS)) {
        ammo[def.id] = { mag: def.mag, reserve: def.reserve };
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.scoped = false;
    },
    ammo() {
      const slot = ammo[state.weaponId];
      return { mag: slot.mag, reserve: slot.reserve };
    },
    setScoped(on) {
      if (!current.scoped) return false;
      state.scoped = on;
      return true;
    },
  };
}
