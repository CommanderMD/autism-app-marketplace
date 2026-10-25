// DEBUG HARNESS (dev.html) - not part of the product. External file because
// the CSP (src/security.js) allows no inline script anywhere.
import { EMOTIONS } from '../engine/faces.js';
import { ITEMS, TASK_TYPES, itemsOfType } from '../engine/items.js';

document.getElementById('out').textContent = JSON.stringify({
  emotions: EMOTIONS,
  itemCount: ITEMS.length,
  itemsByType: Object.fromEntries(TASK_TYPES.map((type) => [type, itemsOfType(type).length])),
}, null, 2);
