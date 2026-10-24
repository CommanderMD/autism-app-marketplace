// Turns an engine/svg.js markup string into a DOM node without innerHTML.
// The library is frozen and self-authored (no scripts, no hrefs), and
// a DOMParser document is inert: nothing in it runs. Returns
// null for an unknown key so the caller can fall back to the text label.
import { svgFor } from '../engine/svg.js';

const parser = new DOMParser();
const cache = new Map();

export function svgNode(key) {
  const markup = svgFor(key);
  if (!markup) return null;
  let tpl = cache.get(key);
  if (!tpl) {
    // Parsed as HTML: the library omits xmlns because it is written for
    // inline use, and the HTML parser puts <svg> in the SVG namespace itself.
    const doc = parser.parseFromString(markup, 'text/html');
    const root = doc.body.querySelector('svg');
    if (!root) return null;
    tpl = document.importNode(root, true);
    cache.set(key, tpl);
  }
  return tpl.cloneNode(true);
}
