import { choice, defineLesson, tap } from '../engine/lesson.js';

const feel = (name) => choice(name, name, name);

// Tap the face that shows the feeling named. Faces differ only in eyes,
// brows and mouth, so the feature that carries the feeling is the cue.
export default defineLesson({
  id: '06-emotions',
  title: 'Emotions & Social Cues',
  order: 6,
  steps: [
    tap('emotions-01', 'Touch the happy face.', 'Touch the happy face.', [feel('happy'), feel('sad')], 'happy'),
    tap('emotions-02', 'Touch the sad face.', 'Touch the sad face.', [feel('happy'), feel('angry'), feel('sad')], 'sad'),
    tap('emotions-03', 'Touch the angry face.', 'Touch the angry face.', [feel('angry'), feel('tired'), feel('happy')], 'angry'),
    tap('emotions-04', 'Touch the tired face.', 'Touch the tired face.', [feel('surprised'), feel('tired'), feel('sad')], 'tired'),
    tap('emotions-05', 'Touch the scared face.', 'Touch the scared face.', [feel('happy'), feel('scared')], 'scared'),
    tap('emotions-06', 'Touch the surprised face.', 'Touch the surprised face.', [feel('angry'), feel('scared'), feel('surprised')], 'surprised'),
    tap('emotions-07', 'Touch the happy face.', 'Touch the happy face.', [feel('tired'), feel('sad'), feel('angry'), feel('happy')], 'happy'),
    tap('emotions-08', 'Touch the sad face.', 'Touch the sad face.', [feel('sad'), feel('surprised')], 'sad'),
  ],
});
