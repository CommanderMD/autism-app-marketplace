// Storefront: public app grid from GET /apps with a category filter that
// lives in the URL (/?category=finance). No login required.
import { api } from '../api.js';
import { el, on, replace, ageRange } from '../ui.js';

const ALL = 'All';

function categoriesOf(apps) {
  return [...new Set(apps.map((a) => a.category).filter(Boolean))].sort();
}

// A category from a shared link may no longer have apps; it still shows (as
// the empty state) rather than silently switching to All.
function currentCategory() {
  return new URLSearchParams(location.search).get('category') || ALL;
}

function card(app) {
  const headingId = `app-${app.id}-name`;
  return el('li', { class: 'card', 'aria-labelledby': headingId },
    el('h2', { id: headingId }, app.name),
    el('p', { class: 'meta' }, `${app.category}${app.subcategory ? ` · ${app.subcategory}` : ''} · ${ageRange(app)}`),
    app.description ? el('p', {}, app.description) : null,
    el('a', { class: 'btn secondary', href: `/app/${encodeURIComponent(app.id)}` },
      'View details', el('span', { class: 'visually-hidden' }, ` for ${app.name}`)));
}

// Roving tabindex: one Tab stop for the whole row; arrow keys move, Home/End jump.
function filterKeys(list) {
  on(list, 'keydown', (event) => {
    const buttons = [...list.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (index === -1) return;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    if (next === null) return;
    event.preventDefault();
    for (const b of buttons) b.tabIndex = -1;
    buttons[next].tabIndex = 0;
    buttons[next].focus();
  });
}

export async function render({ main, setTitle, status }) {
  setTitle('Apps');
  status.textContent = 'Loading apps…';
  const apps = await api('/apps');
  const categories = categoriesOf(apps);

  const filterList = el('ul', { class: 'filters', 'aria-label': 'Filter by category' });
  const grid = el('ul', { class: 'grid', 'aria-labelledby': 'apps-heading' });
  const heading = el('h2', { id: 'apps-heading', class: 'visually-hidden' }, 'App list');

  function show(category) {
    const buttons = [...filterList.querySelectorAll('button')];
    for (const button of buttons) {
      const active = button.dataset.category === category;
      button.setAttribute('aria-pressed', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    if (!buttons.some((b) => b.tabIndex === 0)) buttons[0].tabIndex = 0;
    const visible = category === ALL ? apps : apps.filter((a) => a.category === category);
    if (visible.length === 0) {
      replace(grid, el('li', { class: 'notice' }, 'No apps in this category yet.'));
    } else {
      replace(grid, visible.map(card));
    }
    setTitle(category === ALL ? 'Apps' : `${category} apps`);
    const noun = visible.length === 1 ? 'app' : 'apps';
    status.textContent = category === ALL
      ? `Showing all ${visible.length} ${noun}.`
      : `Showing ${visible.length} ${noun} in ${category}.`;
  }

  function choose(category) {
    const url = new URL(location.href);
    if (category === ALL) url.searchParams.delete('category');
    else url.searchParams.set('category', category);
    history.pushState({ category }, '', url.pathname + url.search);
    show(category);
  }

  replace(filterList, [ALL, ...categories].map((category) =>
    el('li', {}, el('button', {
      type: 'button',
      class: 'filter',
      dataset: { category },
      'aria-pressed': 'false',
      onClick: () => choose(category),
    }, category))));
  filterKeys(filterList);

  replace(main,
    el('h1', {}, 'Apps for learning and life skills'),
    el('p', { class: 'muted' }, 'Browse freely. Parents and schools sign in to give apps to children.'),
    filterList,
    heading,
    grid);

  // Back/forward restores the filter that was in the URL.
  on(window, 'popstate', () => show(currentCategory()));
  show(currentCategory());
}
