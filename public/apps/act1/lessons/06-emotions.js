import { choice, defineLesson, tap } from '../engine/lesson.js';

const feel = (name) => choice(name, name, name);

// Tap the face that shows the feeling named. Faces differ only in eyes,
// brows and mouth, so the feature that carries the feeling is the cue.
export default defineLesson({
  id: '06-emotions',
  title: 'Emotions & Social Cues',
  order: 6,
  steps: [
    tap('emotions-01', 'Tap the happy face.', 'Tap the happy face.', [feel('happy'), feel('sad')], 'happy'),
    tap('emotions-02', 'Tap the sad face.', 'Tap the sad face.', [feel('happy'), feel('angry'), feel('sad')], 'sad'),
    tap('emotions-03', 'Tap the angry face.', 'Tap the angry face.', [feel('angry'), feel('tired'), feel('happy')], 'angry'),
    tap('emotions-04', 'Tap the tired face.', 'Tap the tired face.', [feel('surprised'), feel('tired'), feel('sad')], 'tired'),
    tap('emotions-05', 'Tap the scared face.', 'Tap the scared face.', [feel('happy'), feel('scared')], 'scared'),
    tap('emotions-06', 'Tap the surprised face.', 'Tap the surprised face.', [feel('angry'), feel('scared'), feel('surprised')], 'surprised'),
    tap('emotions-07', 'Tap the happy face.', 'Tap the happy face.', [feel('tired'), feel('sad'), feel('angry'), feel('happy')], 'happy'),
    tap('emotions-08', 'Tap the sad face.', 'Tap the sad face.', [feel('sad'), feel('surprised')], 'sad'),
  ],
});
