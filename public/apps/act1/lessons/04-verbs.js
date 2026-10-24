import { choice, defineLesson, tap } from '../engine/lesson.js';

const LABELS = {
  run: 'running', jump: 'jumping', eat: 'eating', sleep: 'sleeping',
  drink: 'drinking', wash: 'washing', open: 'opening', sit: 'sitting',
};
const verb = (v) => choice(v, LABELS[v], v);

// Tap the picture of the action named.
export default defineLesson({
  id: '04-verbs',
  title: 'Action Verbs',
  order: 4,
  steps: [
    tap('verbs-01', 'Tap running.', 'Tap running.', [verb('run'), verb('sleep'), verb('sit')], 'run'),
    tap('verbs-02', 'Tap jumping.', 'Tap jumping.', [verb('eat'), verb('jump')], 'jump'),
    tap('verbs-03', 'Tap eating.', 'Tap eating.', [verb('wash'), verb('open'), verb('eat')], 'eat'),
    tap('verbs-04', 'Tap sleeping.', 'Tap sleeping.', [verb('sleep'), verb('run'), verb('drink')], 'sleep'),
    tap('verbs-05', 'Tap drinking.', 'Tap drinking.', [verb('jump'), verb('drink'), verb('sit'), verb('open')], 'drink'),
    tap('verbs-06', 'Tap washing.', 'Tap washing.', [verb('sleep'), verb('eat'), verb('wash')], 'wash'),
    tap('verbs-07', 'Tap opening.', 'Tap opening.', [verb('open'), verb('jump')], 'open'),
    tap('verbs-08', 'Tap sitting.', 'Tap sitting.', [verb('run'), verb('sit'), verb('wash')], 'sit'),
  ],
});
