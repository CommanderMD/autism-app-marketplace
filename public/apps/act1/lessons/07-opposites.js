import { defineLesson, tap } from '../engine/lesson.js';

// Every step shows one opposite pair and nothing else. Steps 1-7 name the
// word to tap; steps 8-10 name the other half of the pair ("the opposite of").
export default defineLesson({
  id: '07-opposites',
  title: 'Opposites',
  order: 7,
  steps: [
    tap('opposites-01', 'Tap big.', 'Tap big.', ['big', 'small'], 'big'),
    tap('opposites-02', 'Tap small.', 'Tap small.', ['big', 'small'], 'small'),
    tap('opposites-03', 'Tap cold.', 'Tap cold.', ['hot', 'cold'], 'cold'),
    tap('opposites-04', 'Tap up.', 'Tap up.', ['down', 'up'], 'up'),
    tap('opposites-05', 'Tap night.', 'Tap night.', ['night', 'day'], 'night'),
    tap('opposites-06', 'Tap wet.', 'Tap wet.', ['dry', 'wet'], 'wet'),
    tap('opposites-07', 'Tap fast.', 'Tap fast.', ['slow', 'fast'], 'fast'),
    tap('opposites-08', 'Tap the opposite of up.', 'Tap the opposite of up.', ['up', 'down'], 'down'),
    tap('opposites-09', 'Tap the opposite of day.', 'Tap the opposite of day.', ['night', 'day'], 'night'),
    tap('opposites-10', 'Tap the opposite of slow.', 'Tap the opposite of slow.', ['fast', 'slow'], 'fast'),
  ],
});
