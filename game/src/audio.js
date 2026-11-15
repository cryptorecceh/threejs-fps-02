// All sound is synthesized with WebAudio — no audio files, no network. The context
// is created on the first user gesture; in a headless capture it stays silent and
// every call is a safe no-op.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function noiseBuffer(duration) {
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration = 0.12, freq = 1800, gain = 0.5, slideTo = null, type = 'lowpass' }) {
    if (!ensure()) return;
    try {
      const t = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer(duration);
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.setValueAtTime(freq, t);
      if (slideTo !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + duration);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + duration);
      source.connect(filter);
      filter.connect(g);
      g.connect(master);
      source.start(t);
      source.stop(t + duration);
    } catch { /* silent in headless */ }
  }

  function tone({ freq = 440, to = null, duration = 0.1, gain = 0.3, type = 'sine', delay = 0 }) {
    if (!ensure()) return;
    try {
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    } catch { /* silent in headless */ }
  }

  return {
    unlock() { ensure(); },
    shot(weaponId) {
      if (weaponId === 'longshot') {
        burst({ duration: 0.28, freq: 900, gain: 0.7, slideTo: 120 });
        tone({ freq: 140, to: 45, duration: 0.22, gain: 0.5, type: 'sine' });
      } else if (weaponId === 'vk47') {
        burst({ duration: 0.11, freq: 2400, gain: 0.55, slideTo: 220 });
        tone({ freq: 120, to: 55, duration: 0.1, gain: 0.4, type: 'sine' });
      } else {
        burst({ duration: 0.09, freq: 3000, gain: 0.4, slideTo: 400 });
        tone({ freq: 160, to: 70, duration: 0.07, gain: 0.25, type: 'sine' });
      }
    },
    dryClick() { tone({ freq: 1400, duration: 0.03, gain: 0.2, type: 'square' }); },
    reload() {
      tone({ freq: 900, duration: 0.04, gain: 0.2, type: 'square' });
      tone({ freq: 600, duration: 0.04, gain: 0.2, type: 'square', delay: 0.35 });
      tone({ freq: 1200, duration: 0.05, gain: 0.25, type: 'square', delay: 0.7 });
    },
    hit() { tone({ freq: 1900, duration: 0.05, gain: 0.25, type: 'sine' }); },
    kill() {
      tone({ freq: 880, duration: 0.07, gain: 0.3, type: 'sine' });
      tone({ freq: 1320, duration: 0.09, gain: 0.3, type: 'sine', delay: 0.07 });
    },
    hurt() {
      burst({ duration: 0.15, freq: 300, gain: 0.5, slideTo: 90 });
      tone({ freq: 90, to: 50, duration: 0.18, gain: 0.45, type: 'sine' });
    },
    plantTick() { tone({ freq: 1100, duration: 0.05, gain: 0.25, type: 'square' }); },
    planted() {
      tone({ freq: 660, duration: 0.12, gain: 0.3, type: 'sine' });
      tone({ freq: 990, duration: 0.18, gain: 0.3, type: 'sine', delay: 0.12 });
    },
    explosion() {
      burst({ duration: 1.1, freq: 500, gain: 0.9, slideTo: 40 });
      tone({ freq: 70, to: 28, duration: 1.0, gain: 0.8, type: 'sine' });
    },
    roundWin() {
      tone({ freq: 523, duration: 0.14, gain: 0.3, type: 'sine' });
      tone({ freq: 659, duration: 0.14, gain: 0.3, type: 'sine', delay: 0.13 });
      tone({ freq: 784, duration: 0.24, gain: 0.3, type: 'sine', delay: 0.26 });
    },
    roundLose() {
      tone({ freq: 392, duration: 0.16, gain: 0.3, type: 'sine' });
      tone({ freq: 311, duration: 0.28, gain: 0.3, type: 'sine', delay: 0.15 });
    },
    buy() { tone({ freq: 1200, to: 1600, duration: 0.08, gain: 0.25, type: 'sine' }); },
    denied() { tone({ freq: 220, duration: 0.12, gain: 0.3, type: 'square' }); },
  };
}
