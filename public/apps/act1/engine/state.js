// Act 1 engine state machine. Pure: no DOM, no timers, no clock, no
// randomness. reduce() returns a new state and never mutates its input; an
// action that is not legal right now returns the very same state object, so
// the shell can treat `next === prev` as "nothing happened".
//
// Never a penalty: a wrong answer only counts a miss and, from the second
// miss on, asks the shell to reveal the answer. There is no score, no
// lockout and no timer anywhere in this module.
//
// State:
//   lessons         ordered, validated lessons (see ./curriculum.js)
//   lessonId        current lesson
//   stepIndex       0 .. steps.length - 1, never beyond
//   settings        sensory settings, passed through to the reward planner
//   status          'idle' | 'wrong' | 'correct' | 'complete'
//   misses          wrong answers on the current step; reset only by a correct answer
//   revealAnswer    true from the 2nd miss until RETRY
//   highlight       check()'s highlight while revealAnswer, otherwise null
//   pendingAdvance  true after a correct answer, until NEXT
//   reward          { kind: 'task' | 'lesson' } for the shell to play, or null
//   lessonComplete  true once NEXT is taken on the last step
//   nextLessonId    the lesson that completion unlocked (null after the last)
//   completed       ids of completed lessons; drives the unlock chain
//
// Actions: ANSWER { answer }, NEXT, RETRY, SET_SETTINGS { settings },
//          JUMP { lessonId }.

export const REVEAL_AFTER_MISSES = 2;

// Same rule as computeUnlocked in src/routes/progress.js: the first lesson is
// open, each later one opens only when the one before it is completed, and
// the first incomplete lesson ends the chain.
export function unlockedIds(lessons, completed = []) {
  const done = new Set(completed);
  const out = [];
  for (let i = 0; i < lessons.length; i++) {
    if (i > 0 && !done.has(lessons[i - 1].id)) break;
    out.push(lessons[i].id);
  }
  return out;
}

const indexOfLesson = (lessons, id) => lessons.findIndex((l) => l.id === id);

function freshStep(state, patch) {
  return {
    ...state,
    status: 'idle',
    misses: 0,
    revealAnswer: false,
    highlight: null,
    pendingAdvance: false,
    reward: null,
    ...patch,
  };
}

export function initialState({ lessonId, stepIndex = 0, settings, lessons, completed = [] }) {
  if (!Array.isArray(lessons) || lessons.length === 0) throw new Error('initialState: lessons is required');
  const li = indexOfLesson(lessons, lessonId);
  if (li < 0) throw new Error(`initialState: unknown lesson "${lessonId}"`);
  const done = Array.isArray(completed) ? completed.filter((id) => indexOfLesson(lessons, id) >= 0) : [];
  if (!unlockedIds(lessons, done).includes(lessonId)) {
    throw new Error(`initialState: lesson "${lessonId}" is locked`);
  }
  const last = lessons[li].steps.length - 1;
  const si = Number.isInteger(stepIndex) ? Math.min(Math.max(stepIndex, 0), last) : 0;
  return freshStep({
    lessons,
    lessonId,
    stepIndex: si,
    settings: { ...settings },
    lessonComplete: false,
    nextLessonId: null,
    completed: [...new Set(done)],
  }, {});
}

export function currentLesson(state) {
  return state.lessons[indexOfLesson(state.lessons, state.lessonId)];
}

export function currentStep(state) {
  return currentLesson(state).steps[state.stepIndex];
}

export function reduce(state, action) {
  if (!action || typeof action !== 'object') return state;
  switch (action.type) {
    case 'ANSWER': {
      if (state.status === 'correct' || state.lessonComplete) return state;
      const lesson = currentLesson(state);
      const step = lesson.steps[state.stepIndex];
      const result = lesson.check(action.answer, step);
      if (result.correct) {
        return {
          ...state,
          status: 'correct',
          misses: 0,
          revealAnswer: false,
          highlight: null,
          pendingAdvance: true,
          reward: { kind: 'task' },
        };
      }
      const misses = state.misses + 1;
      const revealAnswer = misses >= REVEAL_AFTER_MISSES;
      return {
        ...state,
        status: 'wrong',
        misses,
        revealAnswer,
        highlight: revealAnswer ? result.highlight : null,
        pendingAdvance: false,
        reward: null,
      };
    }

    case 'NEXT': {
      if (state.status !== 'correct') return state;
      const lessons = state.lessons;
      const li = indexOfLesson(lessons, state.lessonId);
      const last = lessons[li].steps.length - 1;
      if (state.stepIndex < last) {
        return freshStep(state, { stepIndex: state.stepIndex + 1 });
      }
      const next = lessons[li + 1] ? lessons[li + 1].id : null;
      return {
        ...state,
        status: 'complete',
        pendingAdvance: false,
        revealAnswer: false,
        highlight: null,
        lessonComplete: true,
        reward: { kind: 'lesson' },
        nextLessonId: next,
        completed: state.completed.includes(state.lessonId) ? state.completed : [...state.completed, state.lessonId],
      };
    }

    case 'RETRY': {
      if (!state.revealAnswer) return state;
      return { ...state, status: 'idle', revealAnswer: false, highlight: null };
    }

    case 'SET_SETTINGS': {
      if (!action.settings || typeof action.settings !== 'object') return state;
      return { ...state, settings: { ...action.settings } };
    }

    case 'JUMP': {
      const target = action.lessonId;
      if (target === state.lessonId) return state;
      if (indexOfLesson(state.lessons, target) < 0) return state;
      if (!unlockedIds(state.lessons, state.completed).includes(target)) return state;
      return freshStep(state, { lessonId: target, stepIndex: 0, lessonComplete: false, nextLessonId: null });
    }

    default:
      return state;
  }
}
