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
    tap('colors-01', 'Touch red.', 'Touch red.', [color('red'), color('blue'), color('yellow')], 'red'),
    tap('colors-02', 'Touch blue.', 'Touch blue.', [color('green'), color('blue')], 'blue'),
    tap('colors-03', 'Touch yellow.', 'Touch yellow.', [color('purple'), color('orange'), color('yellow')], 'yellow'),
    tap('colors-04', 'Touch green.', 'Touch green.', [color('green'), color('red'), color('blue')], 'green'),
    tap('colors-05', 'Touch orange.', 'Touch orange.', [color('yellow'), color('orange'), color('purple'), color('green')], 'orange'),
    tap('colors-06', 'Touch purple.', 'Touch purple.', [color('blue'), color('red'), color('purple')], 'purple'),
    tap('colors-07', 'Touch red.', 'Touch red.', [color('orange'), color('red')], 'red'),
    tap('colors-08', 'Touch green.', 'Touch green.', [color('yellow'), color('purple'), color('green')], 'green'),
  ],
});
