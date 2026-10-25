// DEBUG HARNESS (dev.html) - not part of the product. External file because
// the CSP (src/security.js) allows no inline script anywhere.
import { LADDERS } from '../engine/ladders.js';

document.getElementById('out').textContent = JSON.stringify({
  ladderCount: LADDERS.length,
  ladders: LADDERS.map((ladder) => ({ id: ladder.id, rungs: ladder.rungs.map((rung) => rung.word) })),
}, null, 2);
