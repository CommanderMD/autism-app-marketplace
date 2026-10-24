// Act 1 reward planner. Pure data: planReward returns a declarative plan the
// shell renders and plays. No DOM, no timers, no Audio/AudioContext here.
//
// EVENT  { type: 'burst' | 'confetti' | 'pulse' | 'glow',
//          at,             // ms offset from reward start
//          durationMs,
//          luminanceDelta, // 0-1, change in the frame's overall luminance
//          fullScreen }    // true only for effects covering the viewport
// Each event is ONE rise and fall. A renderer must never loop or repeat an
// event: repetition is what turns a glow into a flash train.
//
// WCAG 2.3.1 (Three Flashes or Below Threshold). A flash is a pair of opposing
// luminance changes of 10% or more (with the darker state below 0.8), so an
// event counts as a flash when luminanceDelta >= 0.10. flashRate sweeps a
// closed 1000 ms window over the timeline; planReward keeps it <= 3 for every
// kind and every setting by spacing flash-eligible events at least
// FLASH_SPACING_MS apart AFTER speed scaling (400 ms -> at most 3 starts in
// any closed 1 s window). animation_speed only shortens durations and the
// spacing of non-flash events; it can never buy an extra flash.
//
// Safe mode (on unless the setting is explicitly false - the server default)
// is stricter than the WCAG floor: zero flashes, no full-screen events, every
// luminanceDelta < 0.10 (capped at SAFE_LUMINANCE_CAP), only local glow/pulse.
// High contrast applies the same luminance cap. animations: false, or a
// caller-supplied reduced: true (prefers-reduced-motion), means no visual
// events at all - the reward still exists as sound.

export const FLASH_THRESHOLD = 0.10;
export const FLASH_WINDOW_MS = 1000;
export const MAX_FLASHES_PER_WINDOW = 3;
export const FLASH_SPACING_MS = 400;
export const SAFE_LUMINANCE_CAP = 0.08;
export const MAX_GAIN = 0.3;

const DEFAULTS = Object.freeze({
  volume: 60, flash_intensity: 50, animation_speed: 1, contrast: 'normal', animations: true, safe_mode: true,
});

// Base timelines at speed 1 and intensity 100. luminanceDelta here is the
// maximum; flash_intensity scales it down.
const FULL = Object.freeze({
  task: [
    { type: 'burst', at: 0, durationMs: 240, luminanceDelta: 0.35, fullScreen: false },
    { type: 'confetti', at: 400, durationMs: 600, luminanceDelta: 0.2, fullScreen: false },
  ],
  lesson: [
    { type: 'burst', at: 0, durationMs: 240, luminanceDelta: 0.35, fullScreen: false },
    { type: 'confetti', at: 400, durationMs: 900, luminanceDelta: 0.25, fullScreen: false },
    { type: 'glow', at: 800, durationMs: 600, luminanceDelta: 0.15, fullScreen: true },
    { type: 'burst', at: 1200, durationMs: 240, luminanceDelta: 0.35, fullScreen: false },
  ],
});

const GENTLE = Object.freeze({
  task: [
    { type: 'glow', at: 0, durationMs: 500, luminanceDelta: 0.08, fullScreen: false },
  ],
  lesson: [
    { type: 'glow', at: 0, durationMs: 600, luminanceDelta: 0.08, fullScreen: false },
    { type: 'pulse', at: 700, durationMs: 600, luminanceDelta: 0.06, fullScreen: false },
    { type: 'glow', at: 1400, durationMs: 600, luminanceDelta: 0.08, fullScreen: false },
  ],
});

// Gentle rising notes, fixed: the same reward always sounds the same.
const NOTES = Object.freeze({
  task: [
    { freq: 523.25, startMs: 0, durationMs: 160 },
    { freq: 659.25, startMs: 160, durationMs: 220 },
  ],
  lesson: [
    { freq: 523.25, startMs: 0, durationMs: 180 },
    { freq: 659.25, startMs: 180, durationMs: 180 },
    { freq: 783.99, startMs: 360, durationMs: 320 },
  ],
});

const num = (v, min, max, dflt) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, min), max) : dflt);
// Only an explicit false (or 0) turns a default-on flag off.
const flag = (v, dflt) => (v === false || v === 0 ? false : v === true || v === 1 ? true : dflt);
const round = (v, places = 4) => Math.round(v * 10 ** places) / 10 ** places;

function normalize(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return {
    volume: num(s.volume, 0, 100, DEFAULTS.volume),
    flash_intensity: num(s.flash_intensity, 0, 100, DEFAULTS.flash_intensity),
    animation_speed: num(s.animation_speed, 0.25, 2, DEFAULTS.animation_speed),
    contrast: s.contrast === 'high' ? 'high' : 'normal',
    animations: flag(s.animations, DEFAULTS.animations),
    safe_mode: flag(s.safe_mode, DEFAULTS.safe_mode),
  };
}

// Push every flash-eligible event to at least FLASH_SPACING_MS after the
// previous flash-eligible one. Input is sorted by `at`.
function enforceSpacing(events) {
  let lastFlash = -Infinity;
  return events.map((e) => {
    if (e.luminanceDelta < FLASH_THRESHOLD) return e;
    const at = Math.max(e.at, lastFlash + FLASH_SPACING_MS);
    lastFlash = at;
    return { ...e, at };
  });
}

// Pure. Returns a declarative plan.
export function planReward({ kind, settings, now = 0, reduced = false } = {}) {
  const k = kind === 'lesson' ? 'lesson' : 'task';
  const s = normalize(settings);
  const capped = s.safe_mode || s.contrast === 'high' || reduced === true;
  const visual = s.animations && reduced !== true;
  const intensity = s.flash_intensity / 100;
  const speed = s.animation_speed;

  let events = [];
  if (visual) {
    const base = s.safe_mode ? GENTLE[k] : FULL[k];
    events = base.map((e) => {
      let delta = e.luminanceDelta * intensity;
      if (capped) delta = Math.min(delta, SAFE_LUMINANCE_CAP);
      return {
        type: e.type,
        at: Math.round(e.at / speed),
        durationMs: Math.round(e.durationMs / speed),
        luminanceDelta: round(delta),
        fullScreen: s.safe_mode ? false : e.fullScreen,
      };
    });
    events = enforceSpacing(events);
  }

  const gain = s.volume > 0 ? round(Math.min((s.volume / 100) * MAX_GAIN, MAX_GAIN), 3) : 0;
  return {
    kind: k,
    startAt: typeof now === 'number' && Number.isFinite(now) ? now : 0,
    safeMode: s.safe_mode,
    reduced: capped || !visual,
    events,
    sound: { enabled: s.volume > 0, notes: NOTES[k].map((n) => ({ ...n })), gain },
  };
}

// Pure. Worst-case number of flash-eligible events whose `at` falls in any
// closed 1000 ms window.
export function flashRate(events) {
  if (!Array.isArray(events)) return 0;
  const times = events
    .filter((e) => e && typeof e.luminanceDelta === 'number' && e.luminanceDelta >= FLASH_THRESHOLD)
    .map((e) => e.at)
    .sort((a, b) => a - b);
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < times.length; hi++) {
    while (times[hi] - times[lo] > FLASH_WINDOW_MS) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

// Pure. True when the plan breaks WCAG 2.3.1 (more than 3 flashes in any
// 1 s window), has an event whose timing is not a finite number, or - in safe
// mode - contains any full-screen event or any luminance change >= 0.10.
export function violatesFlashBudget(plan) {
  const events = plan && Array.isArray(plan.events) ? plan.events : [];
  if (events.some((e) => !e || !Number.isFinite(e.at) || !Number.isFinite(e.luminanceDelta))) return true;
  if (flashRate(events) > MAX_FLASHES_PER_WINDOW) return true;
  if (plan && plan.safeMode) {
    if (events.some((e) => e.fullScreen === true || e.luminanceDelta >= FLASH_THRESHOLD)) return true;
  }
  return false;
}
