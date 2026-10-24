import { defineLesson, tap } from '../engine/lesson.js';

// Tap the shape named. One shape word per prompt, nothing else to do.
export default defineLesson({
  id: '01-shapes',
  title: 'Basic Shapes',
  order: 1,
  steps: [
    tap('shapes-01', 'Tap the circle.', 'Tap the circle.', ['circle', 'square', 'triangle'], 'circle'),
    tap('shapes-02', 'Tap the square.', 'Tap the square.', ['triangle', 'square'], 'square'),
    tap('shapes-03', 'Tap the triangle.', 'Tap the triangle.', ['circle', 'rectangle', 'triangle'], 'triangle'),
    tap('shapes-04', 'Tap the rectangle.', 'Tap the rectangle.', ['rectangle', 'square', 'star'], 'rectangle'),
    tap('shapes-05', 'Tap the star.', 'Tap the star.', ['square', 'star', 'circle'], 'star'),
    tap('shapes-06', 'Tap the circle.', 'Tap the circle.', ['star', 'triangle', 'circle', 'rectangle'], 'circle'),
    tap('shapes-07', 'Tap the triangle.', 'Tap the triangle.', ['triangle', 'star'], 'triangle'),
    tap('shapes-08', 'Tap the rectangle.', 'Tap the rectangle.', ['circle', 'triangle', 'rectangle'], 'rectangle'),
    tap('shapes-09', 'Tap the star.', 'Tap the star.', ['rectangle', 'circle', 'triangle', 'star'], 'star'),
    tap('shapes-10', 'Tap the square.', 'Tap the square.', ['square', 'circle', 'star'], 'square'),
  ],
});
