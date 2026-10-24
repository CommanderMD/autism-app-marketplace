import { choice, defineLesson, tap } from '../engine/lesson.js';

// Every swatch carries its colour word as the label and a dark outline, so
// colour is never the only cue (see the contrast note in ../engine/svg.js).
const color = (name) => choice(name, name, `color-${name}`);

// Tap the colour named.
export default defineLesson({
  id: '05-colors',
  title: 'Colors',
  order: 5,
  steps: [
    tap('colors-01', 'Tap red.', 'Tap red.', [color('red'), color('blue'), color('yellow')], 'red'),
    tap('colors-02', 'Tap blue.', 'Tap blue.', [color('green'), color('blue')], 'blue'),
    tap('colors-03', 'Tap yellow.', 'Tap yellow.', [color('purple'), color('orange'), color('yellow')], 'yellow'),
    tap('colors-04', 'Tap green.', 'Tap green.', [color('green'), color('red'), color('blue')], 'green'),
    tap('colors-05', 'Tap orange.', 'Tap orange.', [color('yellow'), color('orange'), color('purple'), color('green')], 'orange'),
    tap('colors-06', 'Tap purple.', 'Tap purple.', [color('blue'), color('red'), color('purple')], 'purple'),
    tap('colors-07', 'Tap red.', 'Tap red.', [color('orange'), color('red')], 'red'),
    tap('colors-08', 'Tap green.', 'Tap green.', [color('yellow'), color('purple'), color('green')], 'green'),
  ],
});
