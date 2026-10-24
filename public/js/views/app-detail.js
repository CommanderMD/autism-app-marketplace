// App detail: GET /apps/:id. A parent can grant the app to one of their
// children (picker filled from GET /api/children); a school admin is sent to
// the school dashboard to grant in bulk.
import { api, ApiError } from '../api.js';
import { getMe } from '../session.js';
import { el, replace, field, liveRegion, announce, busy, notice, ageRange } from '../ui.js';

function details(app) {
  const rows = [
    ['Category', app.category],
    ['Subcategory', app.subcategory || 'Not set'],
    ['Age range', ageRange(app)],
    ['Difficulty', app.difficulty_level ? `${app.difficulty_level} of 5` : 'Not set'],
  ];
  return el('dl', { class: 'dl' }, rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

// The picker is built only after the parent asks for it, from a fresh
// /api/children response. No child name exists in the page before that.
function parentGrant(app) {
  const live = liveRegion();
  const area = el('div', { class: 'panel stack' });
  const open = el('button', { type: 'button', 'aria-expanded': 'false' }, 'Add to my child');

  open.addEventListener('click', () => busy(open, async () => {
    try {
      const children = await api('/api/children');
      open.setAttribute('aria-expanded', 'true');
      open.hidden = true;
      if (children.length === 0) {
        replace(area, el('p', {}, 'You have no children added yet. ',
          el('a', { href: '/parent' }, 'Add a child on your dashboard'), '.'), live);
        return;
      }
      const picker = field({
        label: 'Which child?', name: 'child', kind: 'select',
        options: children.map((c) => ({ value: c.id, label: c.name })),
      });
      const submit = el('button', { type: 'submit' }, 'Grant app');
      const form = el('form', { class: 'form-row', novalidate: true }, picker.wrap, submit);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        busy(submit, async () => {
          const child = picker.input.selectedOptions[0];
          try {
            await api(`/api/children/${encodeURIComponent(picker.input.value)}/apps`, {
              method: 'POST', body: { app_id: app.id },
            });
            announce(live, `${app.name} is now available to ${child.textContent}.`);
          } catch (err) {
            announce(live, err.message);
          }
        });
      });
      replace(area, form, live);
      picker.input.focus();
    } catch (err) {
      announce(live, err.message);
    }
  }));

  replace(area, open, live);
  return area;
}

export async function render({ main, params, setTitle }) {
  const [id] = params;
  let app;
  try {
    app = await api(`/apps/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      setTitle('App not found');
      replace(main,
        el('h1', {}, 'App not found'),
        el('p', {}, 'There is no app at this address. It may have been removed or the link may be mistyped.'),
        el('p', {}, el('a', { href: '/' }, 'Back to all apps')));
      return;
    }
    throw err;
  }

  setTitle(app.name);
  const user = await getMe().catch(() => null);

  let action = null;
  if (!app.is_active) {
    action = notice('This app is not currently available to grant.');
  } else if (user && user.role === 'parent') {
    action = parentGrant(app);
  } else if (user && user.role === 'school_admin') {
    action = el('p', {}, el('a', { class: 'btn', href: '/school' }, 'Grant to children'));
  } else if (!user) {
    action = el('p', { class: 'muted' }, 'Parents and schools can ',
      el('a', { href: `/login?next=${encodeURIComponent(location.pathname)}` }, 'sign in'),
      ' to give this app to a child.');
  }

  replace(main,
    el('p', {}, el('a', { href: '/' }, 'All apps')),
    el('h1', {}, app.name),
    app.description ? el('p', {}, app.description) : null,
    details(app),
    action);
}
