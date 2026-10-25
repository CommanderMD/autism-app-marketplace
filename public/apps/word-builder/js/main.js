// Word Builder placeholder shell. Proves the launch gate routes this app to its
// own page; the Word Builder build replaces this file with the real game.

const APP_NAME = 'Word Builder';

const childMeta = document.querySelector('meta[name="child-id"]');
const appMeta = document.querySelector('meta[name="app-id"]');
const childId = childMeta ? childMeta.content.trim() : '';
const appId = appMeta ? appMeta.content.trim() : '';

const heading = document.createElement('h1');
heading.textContent = APP_NAME;
heading.dataset.appId = appId;
if (childId) heading.dataset.ready = 'true';
document.getElementById('app').replaceChildren(heading);
