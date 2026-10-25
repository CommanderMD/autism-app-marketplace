import { defineLesson, tap } from '../engine/lesson.js';

// Every step shows one opposite pair and nothing else. Steps 1-7 name the
// word to tap; steps 8-10 name the other half of the pair ("the opposite of").
export default defineLesson({
  id: '07-opposites',
  title: 'Opposites',
  order: 7,
  steps: [
    tap('opposites-01', 'Touch big.', 'Touch big.', ['big', 'small'], 'big'),
    tap('opposites-02', 'Touch small.', 'Touch small.', ['big', 'small'], 'small'),
    tap('opposites-03', 'Touch cold.', 'Touch cold.', ['hot', 'cold'], 'cold'),
    tap('opposites-04', 'Touch up.', 'Touch up.', ['down', 'up'], 'up'),
    tap('opposites-05', 'Touch night.', 'Touch night.', ['night', 'day'], 'night'),
    tap('opposites-06', 'Touch wet.', 'Touch wet.', ['dry', 'wet'], 'wet'),
    tap('opposites-07', 'Touch fast.', 'Touch fast.', ['slow', 'fast'], 'fast'),
    tap('opposites-08', 'Touch the opposite of up.', 'Touch the opposite of up.', ['up', 'down'], 'down'),
    tap('opposites-09', 'Touch the opposite of day.', 'Touch the opposite of day.', ['night', 'day'], 'night'),
    tap('opposites-10', 'Touch the opposite of slow.', 'Touch the opposite of slow.', ['fast', 'slow'], 'fast'),
  ],
});
