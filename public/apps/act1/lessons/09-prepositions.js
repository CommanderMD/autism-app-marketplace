import { choice, defineLesson, tap } from '../engine/lesson.js';

// The same blue ball moves around a box. "Under" needs a table, so the steps
// about the table compare only table pictures: the object is never the cue.
const box = (rel, words) => choice(`${rel}-box`, `${words} the box`, `ball-${rel}-box`);
const table = (rel, words) => choice(`${rel}-table`, `${words} the table`, `ball-${rel}-table`);

const IN = box('in', 'in');
const ON = box('on', 'on');
const NEXT = box('next-to', 'next to');
const BEHIND = box('behind', 'behind');
const FRONT = box('in-front-of', 'in front of');
const T_UNDER = table('under', 'under');
const T_ON = table('on', 'on');
const T_NEXT = table('next-to', 'next to');

export default defineLesson({
  id: '09-prepositions',
  title: 'Spatial Prepositions',
  order: 9,
  steps: [
    tap('prepositions-01', 'Tap the ball in the box.', 'Tap the ball in the box.', [IN, ON, NEXT], 'in-box'),
    tap('prepositions-02', 'Tap the ball on the box.', 'Tap the ball on the box.', [NEXT, ON, IN], 'on-box'),
    tap('prepositions-03', 'Tap the ball under the table.', 'Tap the ball under the table.', [T_ON, T_UNDER], 'under-table'),
    tap('prepositions-04', 'Tap the ball next to the box.', 'Tap the ball next to the box.', [IN, NEXT, BEHIND], 'next-to-box'),
    tap('prepositions-05', 'Tap the ball behind the box.', 'Tap the ball behind the box.', [FRONT, BEHIND], 'behind-box'),
    tap('prepositions-06', 'Tap the ball in front of the box.', 'Tap the ball in front of the box.', [BEHIND, ON, FRONT], 'in-front-of-box'),
    tap('prepositions-07', 'Tap the ball on the table.', 'Tap the ball on the table.', [T_UNDER, T_NEXT, T_ON], 'on-table'),
    tap('prepositions-08', 'Tap the ball next to the table.', 'Tap the ball next to the table.', [T_NEXT, T_UNDER], 'next-to-table'),
    tap('prepositions-09', 'Tap the ball in the box.', 'Tap the ball in the box.', [BEHIND, IN, FRONT, ON], 'in-box'),
  ],
});
