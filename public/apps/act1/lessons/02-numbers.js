import { choice, defineLesson, drag, tap } from '../engine/lesson.js';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const num = (n) => choice(`n${n}`, String(n), `num-${n}`);
const dots = (n) => choice(`d${n}`, `${WORDS[n]} dots`, `dots-${n}`);
// Identical draggable items; only the count matters.
const items = (svg, k) => Array.from({ length: k }, (_, i) => choice(`${svg}-${i + 1}`, svg, svg));

// 1-10: tap the numeral, tap the group with that many dots, drag that many.
export default defineLesson({
  id: '02-numbers',
  title: 'Numbers & Counting',
  order: 2,
  steps: [
    tap('numbers-01', 'Tap the number 2.', 'Tap the number two.', [num(2), num(5)], 'n2'),
    tap('numbers-02', 'Tap the number 7.', 'Tap the number seven.', [num(1), num(7), num(4)], 'n7'),
    tap('numbers-03', 'Tap 3 dots.', 'Tap three dots.', [dots(5), dots(3), dots(1)], 'd3'),
    tap('numbers-04', 'Tap the number 10.', 'Tap the number ten.', [num(6), num(9), num(10)], 'n10'),
    drag('numbers-05', 'Drag 3 stars to the basket.', 'Drag three stars to the basket.', items('star', 4), { zone: 'basket', count: 3 }),
    tap('numbers-06', 'Tap 6 dots.', 'Tap six dots.', [dots(6), dots(8), dots(4)], 'd6'),
    tap('numbers-07', 'Tap the number 5.', 'Tap the number five.', [num(5), num(3), num(8), num(2)], 'n5'),
    tap('numbers-08', 'Tap 8 dots.', 'Tap eight dots.', [dots(10), dots(8), dots(5)], 'd8'),
    drag('numbers-09', 'Drag 2 apples to the basket.', 'Drag two apples to the basket.', items('apple', 3), { zone: 'basket', count: 2 }),
    tap('numbers-10', 'Tap the number 9.', 'Tap the number nine.', [num(9), num(6)], 'n9'),
  ],
});
