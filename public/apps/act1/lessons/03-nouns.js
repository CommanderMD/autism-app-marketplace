import { defineLesson, tap } from '../engine/lesson.js';

// Tap the object named. Everyday things a child sees at home.
export default defineLesson({
  id: '03-nouns',
  title: 'Common Nouns',
  order: 3,
  steps: [
    tap('nouns-01', 'Tap the cup.', 'Tap the cup.', ['cup', 'shoe', 'ball'], 'cup'),
    tap('nouns-02', 'Tap the shoe.', 'Tap the shoe.', ['dog', 'shoe'], 'shoe'),
    tap('nouns-03', 'Tap the ball.', 'Tap the ball.', ['apple', 'bed', 'ball'], 'ball'),
    tap('nouns-04', 'Tap the dog.', 'Tap the dog.', ['dog', 'spoon', 'book'], 'dog'),
    tap('nouns-05', 'Tap the apple.', 'Tap the apple.', ['cup', 'apple', 'shoe', 'bed'], 'apple'),
    tap('nouns-06', 'Tap the bed.', 'Tap the bed.', ['book', 'ball', 'bed'], 'bed'),
    tap('nouns-07', 'Tap the spoon.', 'Tap the spoon.', ['spoon', 'cup'], 'spoon'),
    tap('nouns-08', 'Tap the book.', 'Tap the book.', ['dog', 'book', 'apple'], 'book'),
  ],
});
