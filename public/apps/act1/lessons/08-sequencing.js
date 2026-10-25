import { choice, defineLesson, sequence } from '../engine/lesson.js';

const PROMPT_TAIL = 'Touch the pictures in order.';
const routine = (id, name, choices, answer) =>
  sequence(id, `${name}. ${PROMPT_TAIL}`, `${name}. ${PROMPT_TAIL}`, choices, answer);

// Three-step routines, every step in sequence mode. The pictures are shown in
// a fixed authored order that is never the answer order; the child taps
// first, next, last. Each routine has only one sensible order.
export default defineLesson({
  id: '08-sequencing',
  title: 'Sequencing & Routines',
  order: 8,
  steps: [
    routine('sequencing-01', 'Wash hands',
      [choice('soap', 'soap', 'wash-soap'), choice('water', 'water', 'wash-water'), choice('towel', 'towel', 'wash-towel')],
      ['water', 'soap', 'towel']),
    routine('sequencing-02', 'Get dressed',
      [choice('clothes', 'clothes on', 'clothes'), choice('shoes', 'shoes on', 'shoe'), choice('pajamas', 'pajamas off', 'pajamas')],
      ['pajamas', 'clothes', 'shoes']),
    routine('sequencing-03', 'Eat lunch',
      [choice('eat', 'eat the food', 'plate-food'), choice('done', 'empty plate', 'plate-empty'), choice('sit', 'sit at the table', 'table')],
      ['sit', 'eat', 'done']),
    routine('sequencing-04', 'Brush teeth',
      [choice('brush', 'brush', 'toothbrush'), choice('rinse', 'rinse', 'cup'), choice('paste', 'toothpaste', 'toothpaste')],
      ['paste', 'brush', 'rinse']),
    routine('sequencing-05', 'Go to bed',
      [choice('bed', 'bed', 'bed'), choice('bath', 'bath', 'bath'), choice('pajamas', 'pajamas on', 'pajamas')],
      ['bath', 'pajamas', 'bed']),
    routine('sequencing-06', 'Grow a flower',
      [choice('flower', 'flower', 'flower'), choice('seed', 'seed', 'seed'), choice('water', 'water', 'watering-can')],
      ['seed', 'water', 'flower']),
    routine('sequencing-07', 'Make a sandwich',
      [choice('filling', 'add cheese', 'filling'), choice('sandwich', 'sandwich', 'sandwich'), choice('bread', 'bread', 'bread')],
      ['bread', 'filling', 'sandwich']),
    routine('sequencing-08', 'Build a tower',
      [choice('three', 'three blocks', 'blocks-3'), choice('one', 'one block', 'blocks-1'), choice('two', 'two blocks', 'blocks-2')],
      ['one', 'two', 'three']),
  ],
});
