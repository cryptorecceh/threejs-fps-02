// Player movement: acceleration, friction, gravity, crouch and jump, resolved as a
// box against the world's colliders one axis at a time, so a wall never swallows the
// player. Bots reuse the same axis-separated mover through moveBody().
import * as THREE from 'three';

export const BODY = { radius: 0.34, standHeight: 1.72, crouchHeight: 1.12, standEye: 1.6, crouchEye: 1.02 };
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function makeBoxTester(colliders) {
  const probe = new THREE.Box3();
  return function overlaps(x, y, z, height, lift) {
    probe.min.set(x - BODY.radius, y + lift, z - BODY.radius);
    probe.max.set(x + BODY.radius, y + height - lift, z + BODY.radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  };
}

// Shared axis-separated mover: position and velocity are mutated in place.
export function moveBody(state, overlaps, dt, wishX, wishZ, speed, jumping) {
  const blend = Math.min(1, (state.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
  state.velocity.x += (wishX * speed - state.velocity.x) * blend;
  state.velocity.z += (wishZ * speed - state.velocity.z) * blend;
  if (state.onGround && wishX === 0 && wishZ === 0) {
    const damp = Math.max(0, 1 - FRICTION * dt);
    state.velocity.x *= damp;
    state.velocity.z *= damp;
  }
  if (jumping && state.onGround) {
    state.velocity.y = JUMP_SPEED;
    state.onGround = false;
  }
  state.velocity.y -= GRAVITY * dt;

  const nextX = state.position.x + state.velocity.x * dt;
  if (!overlaps(nextX, state.position.y, state.position.z, state.height, 0.04)) state.position.x = nextX;
  else state.velocity.x = 0;
  const nextZ = state.position.z + state.velocity.z * dt;
  if (!overlaps(state.position.x, state.position.y, nextZ, state.height, 0.04)) state.position.z = nextZ;
  else state.velocity.z = 0;

  state.position.y += state.velocity.y * dt;
  state.onGround = false;
  const hit = overlaps(state.position.x, state.position.y, state.position.z, state.height, 0);
  if (hit && state.velocity.y <= 0) {
    state.position.y = hit.max.y;
    state.velocity.y = 0;
    state.onGround = true;
  } else if (hit) {
    state.position.y = hit.min.y - state.height;
    state.velocity.y = 0;
  }
  if (state.position.y < 0) {
    state.position.y = 0;
    state.velocity.y = 0;
    state.onGround = true;
  }
  state.velocity.y = Math.max(-30, state.velocity.y);
}

export function createPlayer(colliders) {
  const overlaps = makeBoxTester(colliders);
  const player = {
    position: new THREE.Vector3(0, 0, 16.5),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: BODY.standEye,
    onGround: true,
    crouching: false,
    height: BODY.standHeight,
    health: 100,
    armor: 0,
  };
  const wish = new THREE.Vector3();

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = BODY.crouchHeight;
    } else if (!crouching && player.crouching && !overlaps(player.position.x, player.position.y, player.position.z, BODY.standHeight, 0.02)) {
      player.crouching = false;
      player.height = BODY.standHeight;
    }
    const eyeTarget = player.crouching ? BODY.crouchEye : BODY.standEye;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }
    moveBody(player, overlaps, dt, wish.x, wish.z, player.crouching ? CROUCH_SPEED : WALK_SPEED, keys.has('Space'));
  }

  // Damage: armor soaks half the incoming damage until it breaks.
  function damage(amount) {
    let rest = amount;
    if (player.armor > 0) {
      const soaked = Math.min(player.armor, Math.ceil(amount / 2));
      player.armor -= soaked;
      rest = amount - soaked;
    }
    player.health = Math.max(0, player.health - rest);
    return player.health <= 0;
  }

  function reset(x, z, yaw) {
    player.position.set(x, 0, z);
    player.velocity.set(0, 0, 0);
    player.yaw = yaw;
    player.pitch = 0;
    player.health = 100;
    player.armor = 0;
    player.crouching = false;
    player.height = BODY.standHeight;
    player.eye = BODY.standEye;
  }

  return {
    state: player,
    step,
    look,
    recoil,
    damage,
    reset,
    overlaps,
    groundSpeed() {
      return Math.hypot(player.velocity.x, player.velocity.z);
    },
  };
}
