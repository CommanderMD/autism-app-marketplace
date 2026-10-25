// DEBUG HARNESS (dev.html) - not part of the product. External file because
// the CSP (src/security.js) allows no inline script anywhere.
import { PUZZLES, TASK_TYPES, puzzlesOfType } from '../engine/puzzles.js';

document.getElementById('out').textContent = JSON.stringify({
  puzzleCount: PUZZLES.length,
  puzzlesByType: Object.fromEntries(TASK_TYPES.map((type) => [type, puzzlesOfType(type).length])),
}, null, 2);
