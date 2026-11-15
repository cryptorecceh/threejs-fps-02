// Tracers, impact sparks and dust puffs. A small pooled set of line/point meshes
// that fade out; nothing allocates during a round.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;
const MAX_SPARKS = 48;

export function createEffects(scene) {
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
      color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0,
    }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  const sparks = [];
  const sparkGeometry = new THREE.SphereGeometry(0.05, 6, 5);
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    const mesh = new THREE.Mesh(sparkGeometry, new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0,
    }));
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, velocity: new THREE.Vector3() });
  }
  let tracerIndex = 0;
  let sparkIndex = 0;

  return {
    tracer(from, to) {
      const slot = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % MAX_TRACERS;
      const pos = slot.line.geometry.attributes.position;
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, to.x, to.y, to.z);
      pos.needsUpdate = true;
      slot.life = 0.09;
      slot.line.material.opacity = 0.9;
    },
    impact(point, normal) {
      for (let i = 0; i < 5; i += 1) {
        const slot = sparks[sparkIndex];
        sparkIndex = (sparkIndex + 1) % MAX_SPARKS;
        slot.mesh.visible = true;
        slot.mesh.position.copy(point);
        slot.mesh.material.opacity = 1;
        slot.velocity.set(
          normal.x + (Math.random() - 0.5) * 2,
          Math.abs(normal.y) + Math.random() * 1.5 + 0.4,
          normal.z + (Math.random() - 0.5) * 2,
        ).multiplyScalar(2.2);
        slot.life = 0.35 + Math.random() * 0.2;
      }
    },
    step(dt) {
      for (const slot of tracers) {
        if (slot.life <= 0) continue;
        slot.life -= dt;
        slot.line.material.opacity = Math.max(0, slot.life / 0.09) * 0.9;
      }
      for (const slot of sparks) {
        if (slot.life <= 0) {
          slot.mesh.visible = false;
          continue;
        }
        slot.life -= dt;
        slot.velocity.y -= 9 * dt;
        slot.mesh.position.addScaledVector(slot.velocity, dt);
        slot.mesh.material.opacity = Math.max(0, slot.life / 0.5);
      }
    },
  };
}
