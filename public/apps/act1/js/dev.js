// DEBUG HARNESS (dev.html) - not part of the product. External file because
// the CSP (src/security.js) allows no inline script anywhere.
import lesson from '../lessons/01-shapes.js';

const total = lesson.steps.length;
const descriptors = lesson.steps.map((step, index) => lesson.render(step, {
  index, total, settings: {}, isFirst: index === 0, isLast: index === total - 1,
}));
document.getElementById('out').textContent = JSON.stringify(descriptors, null, 2);
