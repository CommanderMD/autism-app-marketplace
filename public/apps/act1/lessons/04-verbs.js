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
    tap('verbs-01', 'Touch running.', 'Touch running.', [verb('run'), verb('sleep'), verb('sit')], 'run'),
    tap('verbs-02', 'Touch jumping.', 'Touch jumping.', [verb('eat'), verb('jump')], 'jump'),
    tap('verbs-03', 'Touch eating.', 'Touch eating.', [verb('wash'), verb('open'), verb('eat')], 'eat'),
    tap('verbs-04', 'Touch sleeping.', 'Touch sleeping.', [verb('sleep'), verb('run'), verb('drink')], 'sleep'),
    tap('verbs-05', 'Touch drinking.', 'Touch drinking.', [verb('jump'), verb('drink'), verb('sit'), verb('open')], 'drink'),
    tap('verbs-06', 'Touch washing.', 'Touch washing.', [verb('sleep'), verb('eat'), verb('wash')], 'wash'),
    tap('verbs-07', 'Touch opening.', 'Touch opening.', [verb('open'), verb('jump')], 'open'),
    tap('verbs-08', 'Touch sitting.', 'Touch sitting.', [verb('run'), verb('sit'), verb('wash')], 'sit'),
  ],
});
