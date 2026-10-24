// The validated Act 1 curriculum. Importing this module throws if any lesson
// breaks the contract or the derived order is not the canonical one, so a bad
// lesson stops the app at load instead of mid-session.
import { validateCurriculum } from './lesson.js';
import shapes from '../lessons/01-shapes.js';
import numbers from '../lessons/02-numbers.js';
import nouns from '../lessons/03-nouns.js';
import verbs from '../lessons/04-verbs.js';
import colors from '../lessons/05-colors.js';
import emotions from '../lessons/06-emotions.js';
import opposites from '../lessons/07-opposites.js';
import sequencing from '../lessons/08-sequencing.js';
import prepositions from '../lessons/09-prepositions.js';
import math from '../lessons/10-math.js';

export const LESSONS = Object.freeze(validateCurriculum([
  shapes, numbers, nouns, verbs, colors, emotions, opposites, sequencing, prepositions, math,
]));
