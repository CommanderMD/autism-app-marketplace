import { choice, defineLesson, tap } from '../engine/lesson.js';

// Tap the shape named. One shape word per prompt, nothing else to do.
export default defineLesson({
  id: '01-shapes',
  title: 'Basic Shapes',
  order: 1,
  steps: [
    tap('shapes-01', 'Touch the circle.', 'Touch the circle.', ['circle', 'square', 'triangle'], 'circle'),
    tap('shapes-02', 'Touch the square.', 'Touch the square.', ['triangle', 'square'], 'square'),
    tap('shapes-03', 'Touch the triangle.', 'Touch the triangle.', ['circle', 'rectangle', 'triangle'], 'triangle'),
    tap('shapes-04', 'Touch the rectangle.', 'Touch the rectangle.', ['rectangle', 'square', 'star'], 'rectangle'),
    tap('shapes-05', 'Touch the star.', 'Touch the star.', ['square', 'star', 'circle'], 'star'),
    tap('shapes-06', 'Touch the circle.', 'Touch the circle.', ['star', 'triangle', 'circle', 'rectangle'], 'circle'),
    tap('shapes-07', 'Touch the triangle.', 'Touch the triangle.', ['triangle', 'star'], 'triangle'),
    tap('shapes-08', 'Touch the rectangle.', 'Touch the rectangle.', ['circle', 'triangle', 'rectangle'], 'rectangle'),
    tap('shapes-09', 'Touch the star.', 'Touch the star.', ['rectangle', 'circle', 'triangle', 'star'], 'star'),
    tap('shapes-10', 'Touch the square.', 'Touch the square.', ['square', 'circle', 'star'], 'square'),
  ],
});

// Combined-cue variant: colour AND shape ("Touch the red square"). Used only
// when the adult turns on "coloured shapes" - it is harder than the default
// because the child must hold two attributes at once. Same ids, same count,
// same shared render/check. Distractors differ by shape OR colour, never both,
// so there is always one attribute to attend to.
const cs = (shape, colour) => choice(`${shape}-${colour}`, `${colour} ${shape}`, `${shape}-${colour}`);
export const colouredSteps = [
  tap('shapes-01', 'Touch the red circle.', 'Touch the red circle.', [cs('circle', 'red'), cs('square', 'red'), cs('circle', 'blue')], 'circle-red'),
  tap('shapes-02', 'Touch the blue square.', 'Touch the blue square.', [cs('square', 'blue'), cs('square', 'yellow')], 'square-blue'),
  tap('shapes-03', 'Touch the green triangle.', 'Touch the green triangle.', [cs('triangle', 'green'), cs('circle', 'green'), cs('triangle', 'orange')], 'triangle-green'),
  tap('shapes-04', 'Touch the yellow rectangle.', 'Touch the yellow rectangle.', [cs('rectangle', 'yellow'), cs('square', 'yellow'), cs('rectangle', 'purple')], 'rectangle-yellow'),
  tap('shapes-05', 'Touch the yellow star.', 'Touch the yellow star.', [cs('star', 'yellow'), cs('star', 'blue'), cs('circle', 'yellow')], 'star-yellow'),
  tap('shapes-06', 'Touch the blue circle.', 'Touch the blue circle.', [cs('star', 'blue'), cs('circle', 'blue'), cs('circle', 'red'), cs('triangle', 'blue')], 'circle-blue'),
  tap('shapes-07', 'Touch the orange triangle.', 'Touch the orange triangle.', [cs('triangle', 'orange'), cs('triangle', 'green')], 'triangle-orange'),
  tap('shapes-08', 'Touch the purple rectangle.', 'Touch the purple rectangle.', [cs('circle', 'purple'), cs('rectangle', 'purple'), cs('rectangle', 'red')], 'rectangle-purple'),
  tap('shapes-09', 'Touch the red star.', 'Touch the red star.', [cs('rectangle', 'red'), cs('star', 'red'), cs('star', 'green'), cs('circle', 'red')], 'star-red'),
  tap('shapes-10', 'Touch the green square.', 'Touch the green square.', [cs('square', 'green'), cs('square', 'orange'), cs('triangle', 'green')], 'square-green'),
];
