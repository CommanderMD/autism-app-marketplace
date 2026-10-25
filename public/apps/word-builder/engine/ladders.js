// Word Builder ladders: the content and its validator.
//
// A ladder is five real 4-letter words, top to bottom. Each rung differs from
// the rung next to it by exactly one letter, and that letter is ALWAYS in the
// same position within one ladder (changeIndex). The position may differ
// BETWEEN ladders - wb-01 changes the first letter, wb-02 the last - but never
// within one ladder, so a child only ever watches one column change.
// Letters are never rearranged.
//
//   {
//     id: 'wb-01',              // ^wb-\d\d$; also the progress lesson_id
//     title: 'Cake by the Lake',
//     changeIndex: 0,           // 0-3: the column that changes on every rung
//     rungs: [                  // exactly RUNGS, top to bottom
//       { word: 'CAKE', clues: { 1: 'easiest', 2: 'middle', 3: 'hardest' } },
//     ],
//   }
//
// Authoring rules (validateLadders enforces the mechanical ones at load):
//   - exactly 5 rungs; every word 4 letters, uppercase A-Z; words distinct
//   - each adjacent pair: Hamming distance 1, differing at changeIndex
//   - every rung has clue levels 1, 2 and 3, each non-empty
//   - (by hand) no proper nouns, no abbreviations, nothing a five-year-old
//     has never heard. Level 1 names the thing; level 3 is a small riddle.
//
// Every word list and clue here is original to this repo.

export const RUNGS = 5;
export const WORD_LENGTH = 4;
export const CLUE_LEVELS = Object.freeze([1, 2, 3]);

const WORD_RE = /^[A-Z]{4}$/;
const LADDER_ID_RE = /^wb-\d\d$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
}

// Indexes at which two equal-length words differ.
export function diffIndexes(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

function fail(id, msg) {
  throw new Error(`ladder ${typeof id === 'string' ? `"${id}"` : '(no id)'}: ${msg}`);
}

function validateRung(id, rung, i) {
  const where = `rung ${i}${isObj(rung) && typeof rung.word === 'string' ? ` ("${rung.word}")` : ''}`;
  if (!isObj(rung)) fail(id, `${where} is not an object`);
  if (typeof rung.word !== 'string' || rung.word.length !== WORD_LENGTH) {
    fail(id, `${where} word must be exactly ${WORD_LENGTH} letters`);
  }
  if (!WORD_RE.test(rung.word)) fail(id, `${where} word must be uppercase A-Z`);
  if (!isObj(rung.clues)) fail(id, `${where} has no clues object`);
  for (const level of CLUE_LEVELS) {
    if (!isText(rung.clues[level])) fail(id, `${where} is missing clue level ${level}`);
  }
}

// Throws with a message naming the ladder id and the failing rung.
export function validateLadder(ladder) {
  if (!isObj(ladder)) fail(null, 'is not an object');
  const { id } = ladder;
  if (!isText(id) || !LADDER_ID_RE.test(id)) fail(id, 'id must match wb-NN');
  if (!isText(ladder.title)) fail(id, 'title must be a non-empty string');
  if (!Number.isInteger(ladder.changeIndex) || ladder.changeIndex < 0 || ladder.changeIndex >= WORD_LENGTH) {
    fail(id, `changeIndex must be an integer 0-${WORD_LENGTH - 1}`);
  }
  if (!Array.isArray(ladder.rungs)) fail(id, 'rungs must be an array');
  if (ladder.rungs.length !== RUNGS) fail(id, `has ${ladder.rungs.length} rungs; must have exactly ${RUNGS}`);
  ladder.rungs.forEach((r, i) => validateRung(id, r, i));

  const seen = new Set();
  ladder.rungs.forEach((r, i) => {
    if (seen.has(r.word)) fail(id, `rung ${i} ("${r.word}") duplicates an earlier word`);
    seen.add(r.word);
    if (i === 0) return;
    const prev = ladder.rungs[i - 1].word;
    const d = hamming(prev, r.word);
    if (d !== 1) fail(id, `rung ${i} ("${r.word}") is Hamming distance ${d} from rung ${i - 1} ("${prev}"); must be 1`);
    const at = diffIndexes(prev, r.word)[0];
    if (at !== ladder.changeIndex) {
      fail(id, `rung ${i} ("${r.word}") changes letter ${at} from rung ${i - 1} ("${prev}"); changeIndex is ${ladder.changeIndex}`);
    }
  });
  return ladder;
}

// Validates every ladder and asserts the ids are unique.
export function validateLadders(ladders) {
  if (!Array.isArray(ladders) || ladders.length === 0) throw new Error('ladders: expected a non-empty array');
  const ids = new Set();
  for (const l of ladders) {
    validateLadder(l);
    if (ids.has(l.id)) throw new Error(`ladders: duplicate ladder id "${l.id}"`);
    ids.add(l.id);
  }
  return ladders;
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const rung = (word, c1, c2, c3) => ({ word, clues: { 1: c1, 2: c2, 3: c3 } });

export const LADDERS = deepFreeze(validateLadders([
  {
    id: 'wb-01',
    title: 'Cake by the Lake',
    changeIndex: 0, // first letter changes
    rungs: [
      rung('CAKE', 'You eat it at a birthday party.', 'A sweet treat that can have candles on top.', 'Flour, eggs and sugar, baked and then iced.'),
      rung('LAKE', 'Big water you can row a boat on.', 'Like a pond, but much bigger.', 'Fresh water with land all the way around it.'),
      rung('BAKE', 'Cook cookies in the oven.', 'What you do to make bread in a hot oven.', 'Cook with dry heat until it rises and turns brown.'),
      rung('RAKE', 'A tool that pulls up leaves.', 'A garden tool with a long handle and many teeth.', 'Sweep fallen leaves into a pile with this.'),
      rung('MAKE', 'Build something new.', 'What you do with paper, glue and crayons.', 'Put things together so a new thing is there.'),
    ],
  },
  {
    id: 'wb-02',
    title: 'Hook and Hoop',
    changeIndex: 3, // last letter changes
    rungs: [
      rung('HOOK', 'Hang your coat on it.', 'A bent piece that catches a fish.', 'Curved at the end so things can hang or catch.'),
      rung('HOOP', 'A big ring you throw a ball through.', 'A round ring you can spin around your waist.', 'A circle with nothing in the middle.'),
      rung('HOOT', 'The sound an owl makes.', 'An owl says this at night.', 'A soft call heard in the dark woods.'),
      rung('HOOD', 'The part of a coat that covers your head.', 'Pull it up when it starts to rain.', 'A soft cover for your head, joined to your jacket.'),
      rung('HOOF', 'A horse walks on it.', 'The hard foot of a horse or a goat.', 'Clip-clop: it makes that sound on the road.'),
    ],
  },
  {
    id: 'wb-03',
    title: 'In the Cave',
    changeIndex: 2, // third letter changes
    rungs: [
      rung('CAVE', 'A dark hole in a rock where a bear sleeps.', 'A hollow in a hill or a cliff.', 'A rocky room that nobody built.'),
      rung('CAGE', 'A box with bars for a pet bird.', 'Bars all around keep the hamster in.', 'A small home you can see through on every side.'),
      rung('CAPE', 'A superhero wears it on their back.', 'A coat with no sleeves that flaps behind you.', 'It ties at your neck and flies out when you run.'),
      rung('CANE', 'A stick that helps someone walk.', 'Candy shaped like a hook, red and white.', 'Lean on this when your legs are tired.'),
      rung('CARE', 'Be kind and look after someone.', 'What you do for a pet when you feed it.', 'Show you mind what happens to someone.'),
    ],
  },
  {
    id: 'wb-04',
    title: 'Pets and Pots',
    changeIndex: 1, // second letter changes
    rungs: [
      rung('PETS', 'Cats and dogs that live with you.', 'Animals you look after at home.', 'Furry friends who share your house.'),
      rung('POTS', 'You cook soup in these.', 'Pans with tall sides for the stove.', 'Plants grow in these, and so does dinner.'),
      rung('PITS', 'The hard seeds inside cherries.', 'The stone in the middle of a peach.', 'Holes in the ground, or seeds you do not eat.'),
      rung('PATS', 'Soft taps on a dog\'s head.', 'Gentle touches with a flat hand.', 'A light tap-tap to say good job.'),
      rung('PUTS', 'She ____ the toy in the box.', 'Sets something down in its place.', 'Places, sets or lays.'),
    ],
  },
  {
    id: 'wb-05',
    title: 'Jump and Bump',
    changeIndex: 0, // first letter changes
    rungs: [
      rung('JUMP', 'Go up in the air with both feet.', 'What a frog or a kangaroo does.', 'Push off the ground and land again.'),
      rung('BUMP', 'A little knock on your head.', 'Two cars touch, gently.', 'A small hill on the road, or a knock.'),
      rung('PUMP', 'It puts air in a bike tire.', 'Push it up and down to fill a ball.', 'It moves air or water from one place to another.'),
      rung('LUMP', 'A small hard bit in your oatmeal.', 'A small pile with no special shape.', 'A bump of something stuck together.'),
      rung('DUMP', 'A big truck tips out dirt.', 'Tip everything out at once.', 'Empty it all out in one go.'),
    ],
  },
  {
    id: 'wb-06',
    title: 'Beans and Bears',
    changeIndex: 3, // last letter changes
    rungs: [
      rung('BEAN', 'A small green food that grows in a pod.', 'A seed you can cook and eat with dinner.', 'Plant a magic one and a giant stalk might grow.'),
      rung('BEAK', 'A bird\'s hard mouth.', 'A duck pecks with this.', 'Pointy or flat, it helps a bird eat.'),
      rung('BEAR', 'A big furry animal that sleeps all winter.', 'It loves honey and fish.', 'A teddy is a soft one of these.'),
      rung('BEAT', 'Hit a drum: boom, boom.', 'The steady sound in a song you clap to.', 'Mix eggs fast, or keep time in music.'),
      rung('BEAD', 'A tiny ball on a string necklace.', 'Thread it to make a bracelet.', 'A small round piece with a hole in the middle.'),
    ],
  },
  {
    id: 'wb-07',
    title: 'Wipe It Wide',
    changeIndex: 2, // third letter changes
    rungs: [
      rung('WIPE', 'Clean the table with a cloth.', 'Rub your messy hands with a towel.', 'Move a cloth across to make it dry or clean.'),
      rung('WIDE', 'Big from side to side.', 'Open your mouth this way at the dentist.', 'The opposite of narrow.'),
      rung('WISE', 'The owl in the story knows a lot.', 'Very clever and good at choosing.', 'Someone who makes good choices is this.'),
      rung('WIRE', 'A thin metal string.', 'It carries power to a lamp.', 'Bend it, twist it, it is made of metal.'),
      rung('WIFE', 'A woman who is married.', 'In the wedding, she became his ____.', 'The name for a woman in a marriage.'),
    ],
  },
  {
    id: 'wb-08',
    title: 'Ball on the Wall',
    changeIndex: 0, // first letter changes
    rungs: [
      rung('BALL', 'You kick it or throw it.', 'A round toy that bounces.', 'Round, it rolls, and every game wants one.'),
      rung('CALL', 'Use the phone to talk to Grandma.', 'Shout someone\'s name so they come.', 'Ring someone, or say their name loudly.'),
      rung('FALL', 'Trip and go down: oops!', 'Leaves do this from the trees.', 'Drop down because nothing holds you up.'),
      rung('TALL', 'A giraffe is very ____.', 'High from bottom to top.', 'The opposite of short.'),
      rung('WALL', 'The side of a room.', 'Bricks stacked up make this.', 'Hang a picture on it.'),
    ],
  },
]));

// The "show me how" model ladder. Read-only, never a scored ladder, never
// posted as progress. Validated by the same rules as the real ones.
export const EXAMPLE_LADDER = deepFreeze(validateLadder({
  id: 'wb-00',
  title: 'Tail to Pail',
  changeIndex: 0, // first letter changes
  rungs: [
    rung('TAIL', 'A dog wags it.', 'The end part of an animal\'s back.', 'It follows the animal everywhere.'),
    rung('SAIL', 'The cloth that makes a boat go.', 'Wind pushes it across the water.', 'A boat\'s big wing.'),
    rung('MAIL', 'Letters that come to your door.', 'The post brings it.', 'Envelopes and parcels sent to you.'),
    rung('NAIL', 'Hit it with a hammer.', 'The hard tip at the end of your finger.', 'Thin metal that holds wood together.'),
    rung('PAIL', 'A bucket for the beach.', 'Carry water in this.', 'Fill it with sand to build a castle.'),
  ],
}));
