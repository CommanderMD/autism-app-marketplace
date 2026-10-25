import { defineLesson, tap } from '../engine/lesson.js';

// Tap the object named. Everyday things a child sees at home.
export default defineLesson({
  id: '03-nouns',
  title: 'Common Nouns',
  order: 3,
  steps: [
    tap('nouns-01', 'Touch the cup.', 'Touch the cup.', ['cup', 'shoe', 'ball'], 'cup'),
    tap('nouns-02', 'Touch the shoe.', 'Touch the shoe.', ['dog', 'shoe'], 'shoe'),
    tap('nouns-03', 'Touch the ball.', 'Touch the ball.', ['apple', 'bed', 'ball'], 'ball'),
    tap('nouns-04', 'Touch the dog.', 'Touch the dog.', ['dog', 'spoon', 'book'], 'dog'),
    tap('nouns-05', 'Touch the apple.', 'Touch the apple.', ['cup', 'apple', 'shoe', 'bed'], 'apple'),
    tap('nouns-06', 'Touch the bed.', 'Touch the bed.', ['book', 'ball', 'bed'], 'bed'),
    tap('nouns-07', 'Touch the spoon.', 'Touch the spoon.', ['spoon', 'cup'], 'spoon'),
    tap('nouns-08', 'Touch the book.', 'Touch the book.', ['dog', 'book', 'apple'], 'book'),
  ],
});
