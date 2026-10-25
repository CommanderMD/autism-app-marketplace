// DEBUG HARNESS (dev.html) - not part of the product. External file because
// the CSP (src/security.js) allows no inline script anywhere.
import { ITEM_IDS } from '../engine/items.js';
import { LINES, LINE_COUNT } from '../engine/bingo.js';

document.getElementById('out').textContent = JSON.stringify({
  itemCount: ITEM_IDS.length,
  itemIds: ITEM_IDS,
  lineCount: LINE_COUNT,
  lines: LINES.length,
}, null, 2);
