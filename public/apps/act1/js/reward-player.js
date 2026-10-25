// Act 1 reward player. Renders the plan from engine/reward.js and nothing else.
//
// Guarantees:
// - It never invents an effect. Every visual is one event from plan.events,
//   drawn once (one rise and fall), with its peak opacity derived from the
//   event's luminanceDelta. Nothing loops.
// - It refuses any plan that violatesFlashBudget() says is unsafe, and plays
//   sound only. That is a runtime guard on top of the engine tests: the shell
//   must never be the thing that flashes a child.
// - No AudioContext exists until unlockAudio() runs from a real user gesture.
//   With plan.sound.enabled false, no AudioContext is created at all.
// - play() resolves when the visual is done, capped at MAX_WAIT_MS.
//
// Opacity from luminance. An event's luminanceDelta is the change in the
// frame's overall luminance it is allowed to cause. A full-screen glow covers
// the frame, so its peak opacity is the delta itself. A local piece covers a
// small area, so it may be more opaque for the same frame-level change;
// LOCAL_AREA_FACTOR converts, and the result is still clamped so a safe-mode
// event (delta <= 0.08) never reaches 50% opacity on even the smallest piece.

import { planReward, violatesFlashBudget } from '../engine/reward.js';

export const MAX_WAIT_MS = 1200;
const LOCAL_AREA_FACTOR = 5;
const LOCAL_OPACITY_CAP = 0.5;
const PIECES = 14;
// Fixed layout, no randomness: the same reward always looks the same. Values
// are fractions of the layer's width/height and a hue index into PIECE_COLOURS.
const PIECE_LAYOUT = Object.freeze([
  [0.18, 0.22, 0], [0.32, 0.14, 1], [0.46, 0.26, 2], [0.60, 0.12, 3], [0.74, 0.24, 4],
  [0.86, 0.16, 0], [0.22, 0.62, 2], [0.36, 0.74, 3], [0.50, 0.66, 4], [0.64, 0.78, 0],
  [0.78, 0.64, 1], [0.12, 0.44, 3], [0.90, 0.48, 2], [0.50, 0.46, 1],
]);
// Marketplace palette colours (all measured >= 4.5:1 on white in engine/svg.js).
const PIECE_COLOURS = Object.freeze(['#1d4ed8', '#15803d', '#c2410c', '#7e22ce', '#c62828']);

function peakOpacity(event) {
  const d = Math.max(0, Math.min(1, Number(event.luminanceDelta) || 0));
  if (event.fullScreen) return d;
  return Math.min(LOCAL_OPACITY_CAP, d * LOCAL_AREA_FACTOR);
}

// One rise-and-fall of `node` to `peak` opacity over `durationMs`, starting
// after `delayMs`. Uses the Web Animations API with iterations: 1 so a frame
// can never repeat. Resolves when finished.
function riseAndFall(node, peak, delayMs, durationMs, extraKeyframes = {}) {
  const frames = [
    { opacity: 0, ...(extraKeyframes.from || {}) },
    { opacity: peak, offset: 0.4, ...(extraKeyframes.mid || {}) },
    { opacity: 0, ...(extraKeyframes.to || {}) },
  ];
  const anim = node.animate(frames, {
    delay: Math.max(0, delayMs),
    duration: Math.max(1, durationMs),
    iterations: 1,
    fill: 'forwards',
    easing: 'ease-in-out',
  });
  return anim.finished.catch(() => undefined);
}

export function createRewardPlayer({ root, settings, prefersReducedMotion = false } = {}) {
  let currentSettings = settings || {};
  let audio = null; // AudioContext, created only by unlockAudio()
  let layer = null;
  let active = [];
  let oscillators = [];

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.className = 'reward-layer';
    layer.setAttribute('aria-hidden', 'true');
    (root || document.body).append(layer);
    return layer;
  }

  function clearLayer() {
    for (const a of active) {
      try { a.cancel(); } catch { /* already finished */ }
    }
    active = [];
    if (layer) layer.replaceChildren();
  }

  function stopSound() {
    for (const o of oscillators) {
      try { o.stop(); } catch { /* already stopped */ }
    }
    oscillators = [];
  }

  function unlockAudio() {
    if (audio) {
      if (audio.state === 'suspended') audio.resume().catch(() => undefined);
      return;
    }
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    try {
      audio = new Ctx();
    } catch {
      audio = null;
    }
  }

  function playSound(sound) {
    if (!sound || !sound.enabled || sound.gain <= 0) return;
    if (!audio) return; // no gesture yet: the reward is silent, never autoplayed
    const t0 = audio.currentTime;
    for (const note of sound.notes) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.freq;
      const start = t0 + note.startMs / 1000;
      const end = start + note.durationMs / 1000;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(sound.gain, start + 0.02);
      gain.gain.linearRampToValueAtTime(0, end);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(end + 0.05);
      oscillators.push(osc);
    }
  }

  // Draws exactly the events in the plan. Returns a promise for the last one.
  function drawEvents(events) {
    if (!events.length) return Promise.resolve();
    const l = ensureLayer();
    const w = l.clientWidth || window.innerWidth;
    const h = l.clientHeight || window.innerHeight;
    const done = [];
    for (const e of events) {
      const peak = peakOpacity(e);
      if (peak <= 0) continue;
      if (e.type === 'glow' || e.type === 'pulse') {
        const g = document.createElement('div');
        g.className = 'reward-glow';
        if (e.fullScreen) {
          g.style.width = '200vmax';
          g.style.height = '200vmax';
          g.style.margin = '-100vmax 0 0 -100vmax';
        }
        l.append(g);
        const scale = e.type === 'pulse' ? { from: { transform: 'scale(0.9)' }, to: { transform: 'scale(1.05)' } } : {};
        done.push(riseAndFall(g, peak, e.at, e.durationMs, scale));
      } else {
        // burst and confetti: a fixed scatter of small pieces, each drawn once.
        const count = e.type === 'burst' ? 8 : PIECES;
        for (let i = 0; i < count; i++) {
          const [fx, fy, c] = PIECE_LAYOUT[i % PIECE_LAYOUT.length];
          const p = document.createElement('span');
          p.className = 'reward-piece';
          p.style.left = `${Math.round(fx * w)}px`;
          p.style.top = `${Math.round(fy * h)}px`;
          p.style.background = PIECE_COLOURS[c];
          l.append(p);
          const drift = e.type === 'confetti' ? { to: { transform: 'translateY(40px) rotate(60deg)' } } : { to: { transform: 'scale(1.6)' } };
          done.push(riseAndFall(p, peak, e.at, e.durationMs, drift));
        }
      }
    }
    active = [...l.getAnimations()];
    return Promise.all(done);
  }

  async function play(kind) {
    clearLayer();
    stopSound();
    const plan = planReward({ kind, settings: currentSettings, reduced: prefersReducedMotion === true });
    let events = plan.events;
    if (violatesFlashBudget(plan)) {
      // Never draw a plan that fails the budget. Sound only.
      console.warn('Act 1 reward: plan refused by flash budget guard', { kind: plan.kind, safeMode: plan.safeMode, events: plan.events.length });
      events = [];
    }
    playSound(plan.sound);
    const visual = drawEvents(events);
    const cap = new Promise((resolve) => setTimeout(resolve, MAX_WAIT_MS));
    await Promise.race([visual, cap]);
  }

  function stop() {
    clearLayer();
    stopSound();
  }

  // One soft note, for the settings panel's "Test sound".
  function testTone() {
    if (!audio) return;
    const vol = Math.max(0, Math.min(100, Number(currentSettings.volume) || 0));
    if (vol === 0) return;
    playSound({ enabled: true, gain: Math.min(0.3, (vol / 100) * 0.3), notes: [{ freq: 523.25, startMs: 0, durationMs: 220 }] });
  }

  function setSettings(next) {
    currentSettings = { ...(next || {}) };
  }

  return { play, stop, unlockAudio, testTone, setSettings, get hasAudio() { return audio !== null; } };
}
