import { choice, defineLesson, drag, tap } from '../engine/lesson.js';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const num = (n) => choice(`n${n}`, String(n), `num-${n}`);
const dots = (n) => choice(`d${n}`, `${WORDS[n]} dots`, `dots-${n}`);
const items = (svg, k) => Array.from({ length: k }, (_, i) => choice(`${svg}-${i + 1}`, svg, svg));

// Sums and differences within 10. The prompt shows digits and signs; the
// audio says the same thing in words ("plus", "take away") so TTS reads it
// cleanly. Answers are numerals or dot counters (visual counters).
export default defineLesson({
  id: '10-math',
  title: 'Addition & Subtraction',
  order: 10,
  steps: [
    tap('math-01', 'Tap 1 + 1.', 'Tap one plus one.', [dots(2), dots(3)], 'd2'),
    tap('math-02', 'Tap 2 + 1.', 'Tap two plus one.', [num(3), num(2), num(4)], 'n3'),
    tap('math-03', 'Tap 3 + 2.', 'Tap three plus two.', [dots(4), dots(5), dots(6)], 'd5'),
    drag('math-04', 'Drag 2 + 1 apples to the basket.', 'Drag two plus one apples to the basket.', items('apple', 4), { zone: 'basket', count: 3 }),
    tap('math-05', 'Tap 4 take away 1.', 'Tap four take away one.', [num(2), num(3), num(5)], 'n3'),
    tap('math-06', 'Tap 5 + 4.', 'Tap five plus four.', [num(9), num(8), num(10)], 'n9'),
    tap('math-07', 'Tap 6 take away 3.', 'Tap six take away three.', [dots(2), dots(4), dots(3)], 'd3'),
    drag('math-08', 'Drag 1 + 1 stars to the basket.', 'Drag one plus one stars to the basket.', items('star', 4), { zone: 'basket', count: 2 }),
    tap('math-09', 'Tap 10 take away 5.', 'Tap ten take away five.', [num(5), num(4), num(6)], 'n5'),
    tap('math-10', 'Tap 7 + 3.', 'Tap seven plus three.', [num(9), num(10)], 'n10'),
  ],
});
