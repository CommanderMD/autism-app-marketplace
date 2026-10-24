// Act 1 companion: the guide character beside the prompt, and the friends a
// child earns as lessons complete.
//
// The companion reflects engine state; it never decides anything. Every
// motion is a frame swap (same brightness, same size) or a transform. Nothing
// here changes colour or luminance, so it adds no flash to any reward plan.
// With animations off (or prefers-reduced-motion) the CSS freezes the
// transforms and the frame swaps stop; the still idle frame remains.
//
// Frames are PNG sprites in /img/act1/, cut from one approved sheet so every
// pose shares the same proportions. The images are decorative: the prompt
// text and the choices carry the meaning, so the <img> has alt="".

export const GUIDE = 'robot';
export const GUIDE_NAME = 'Moby';
export const FRIEND_NAMES = Object.freeze({ otter: 'Otter', owl: 'Owla' });
export const FRAMES = Object.freeze({
  idle: '01-idle', blink: '02-blink', speak: '03-speak', point: '04-point',
  listen: '05-listen', nod: '06-nod', happy: '07-happy', cheer: '08-cheer', wave: '09-wave',
});
// Friends arrive after N completed lessons. Earned company, never points.
export const FRIENDS = Object.freeze([
  { id: 'otter', after: 3, idle: '01-idle', happy: '02-happy' },
  { id: 'owl', after: 6, idle: '01-idle', happy: '02-happy' },
]);

const BLINK_EVERY_MS = 4200;
const BLINK_MS = 140;
const HOLD_MS = { point: 1400, nod: 900, happy: 1100, cheer: 1600, wave: 1400, listen: 0 };

export const spriteUrl = (who, frame) => `/img/act1/${who}-${frame}.png`;

export function preloadGuide() {
  for (const f of Object.values(FRAMES)) {
    const i = new Image();
    i.src = spriteUrl(GUIDE, f);
  }
}

export function createCompanion({ animationsOn = () => true } = {}) {
  const img = document.createElement('img');
  img.className = 'companion';
  img.alt = '';
  img.decoding = 'async';
  img.src = spriteUrl(GUIDE, FRAMES.idle);
  const wrap = document.createElement('div');
  wrap.className = 'companion-slot';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.append(img);

  let base = 'idle';       // the frame we return to
  let speaking = false;
  let holdTimer = null;
  let blinkTimer = null;
  let blinkBack = null;

  function show(frame) {
    img.src = spriteUrl(GUIDE, FRAMES[frame] || FRAMES.idle);
    img.dataset.frame = frame;
  }

  function settle() {
    show(speaking ? 'speak' : base);
  }

  // A short pose, then back to the base state.
  function pose(frame) {
    if (holdTimer) clearTimeout(holdTimer);
    show(frame);
    const hold = HOLD_MS[frame] ?? 1000;
    if (hold > 0) holdTimer = setTimeout(() => { holdTimer = null; settle(); }, hold);
  }

  function scheduleBlink() {
    if (blinkTimer) clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      blinkTimer = null;
      if (animationsOn() && !holdTimer && !speaking && (base === 'idle' || base === 'listen')) {
        show('blink');
        blinkBack = setTimeout(() => { blinkBack = null; settle(); scheduleBlink(); }, BLINK_MS);
      } else {
        scheduleBlink();
      }
    }, BLINK_EVERY_MS);
  }

  function setState(state) {
    // 'idle' | 'listen' | 'point' | 'nod' | 'happy' | 'cheer' | 'wave'
    if (state === 'idle' || state === 'listen') {
      base = state;
      if (!holdTimer) settle();
      return;
    }
    pose(state);
  }

  function setSpeaking(on) {
    speaking = on === true;
    if (!holdTimer) settle();
  }

  function destroy() {
    for (const t of [holdTimer, blinkTimer, blinkBack]) if (t) clearTimeout(t);
    wrap.remove();
  }

  scheduleBlink();
  return { el: wrap, setState, setSpeaking, destroy };
}

// Which friends a child has earned, given completed lesson ids.
export function earnedFriends(completedCount) {
  return FRIENDS.filter((f) => completedCount >= f.after);
}

// The panel shown on "You did it!": the guide cheering plus any earned friends.
export function celebrationRow(completedCount) {
  const row = document.createElement('div');
  row.className = 'friends-row';
  row.setAttribute('aria-hidden', 'true');
  const guide = document.createElement('img');
  guide.className = 'friend guide';
  guide.alt = '';
  guide.src = spriteUrl(GUIDE, FRAMES.cheer);
  row.append(guide);
  for (const f of earnedFriends(completedCount)) {
    const i = document.createElement('img');
    i.className = `friend ${f.id}`;
    i.alt = '';
    i.src = spriteUrl(f.id, f.happy);
    row.append(i);
  }
  return row;
}

// Text the guide says when a friend arrives for the first time.
export function arrivalLine(completedCount) {
  const f = FRIENDS.find((x) => x.after === completedCount);
  if (!f) return null;
  return `A new friend is here. Say hi to ${FRIEND_NAMES[f.id]}!`;
}
