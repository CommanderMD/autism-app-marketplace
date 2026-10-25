// App detail: GET /apps/:id. A parent can grant the app to one of their
// children (picker filled from GET /api/children); a school admin is sent to
// the school dashboard to grant in bulk.
import { api, ApiError } from '../api.js';
import { getMe } from '../session.js';
import { el, replace, field, liveRegion, announce, busy, notice, ageRange } from '../ui.js';
import { t } from '../i18n.js';

function details(app) {
  const rows = [
    [t('detail.category'), app.category],
    [t('detail.subcategory'), app.subcategory || t('common.not_set')],
    [t('detail.age_range'), ageRange(app)],
    [t('detail.difficulty'), app.difficulty_level ? t('detail.difficulty_of', { level: app.difficulty_level }) : t('common.not_set')],
  ];
  return el('dl', { class: 'dl' }, rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

// IEP / learning goals (Phase 5): GET /apps/:id/standards, public, no child
// data. Shown to everyone so a parent or teacher can see what the app works
// on before granting it.
async function goalsSection(app) {
  let data;
  try {
    data = await api(`/apps/${encodeURIComponent(app.id)}/standards`);
  } catch {
    return null;
  }
  const items = data.standards;
  const lessonNumber = (id) => (id ? Number(id.split('-')[0]) : null);
  return el('section', { class: 'panel stack goals', 'aria-labelledby': 'goals-heading' },
    el('h2', { id: 'goals-heading' }, t('detail.goals_heading')),
    el('p', { class: 'muted' }, t('detail.goals_intro')),
    items.length === 0
      ? el('p', {}, t('detail.goals_none'))
      : el('ul', { class: 'goal-list' }, items.map((g) => el('li', {},
        el('strong', {}, g.goal),
        g.lesson_id ? el('span', { class: 'tag' }, t('detail.lesson_n', { n: lessonNumber(g.lesson_id) })) : null,
        el('span', { class: 'tag domain' }, g.domain),
        g.description ? el('p', { class: 'muted' }, g.description) : null))));
}

// The picker is built only after the parent asks for it, from a fresh
// /api/children response. No child name exists in the page before that.
function parentGrant(app) {
  const live = liveRegion();
  const area = el('div', { class: 'panel stack' });
  const open = el('button', { type: 'button', 'aria-expanded': 'false' }, t('detail.add_to_child'));

  open.addEventListener('click', () => busy(open, async () => {
    try {
      const children = await api('/api/children');
      open.setAttribute('aria-expanded', 'true');
      open.hidden = true;
      if (children.length === 0) {
        replace(area, el('p', {}, t('detail.no_children'),
          el('a', { href: '/parent' }, t('detail.add_on_dashboard')), '.'), live);
        return;
      }
      const picker = field({
        label: t('detail.which_child'), name: 'child', kind: 'select',
        options: children.map((c) => ({ value: c.id, label: c.name })),
      });
      const submit = el('button', { type: 'submit' }, t('detail.grant'));
      const form = el('form', { class: 'form-row', novalidate: true }, picker.wrap, submit);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        busy(submit, async () => {
          const child = picker.input.selectedOptions[0];
          try {
            await api(`/api/children/${encodeURIComponent(picker.input.value)}/apps`, {
              method: 'POST', body: { app_id: app.id },
            });
            announce(live, t('detail.granted_to', { app: app.name, child: child.textContent }));
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

// For a signed-in parent: one Play link per child that already has this app,
// through the launch gate. Built from fresh API calls; nothing is cached.
async function parentPlayLinks(app) {
  let children;
  try {
    children = await api('/api/children');
  } catch {
    return null;
  }
  const withApp = [];
  for (const child of children) {
    try {
      const apps = await api(`/api/children/${encodeURIComponent(child.id)}/apps`);
      if (apps.some((a) => a.app_id === app.id)) withApp.push(child);
    } catch {
      /* skip this child; the grant panel still works */
    }
  }
  if (withApp.length === 0) return null;
  return el('div', { class: 'panel stack' },
    el('p', {}, withApp.length === 1 ? t('detail.ready_one') : t('detail.ready_many')),
    el('ul', { class: 'stack' }, withApp.map((child) => el('li', {},
      el('a', {
        class: 'btn',
        href: `/apps/${encodeURIComponent(app.id)}/play?child_id=${encodeURIComponent(child.id)}`,
      }, t('detail.play_as', { child: child.name }))))));
}

export async function render({ main, params, setTitle }) {
  const [id] = params;
  let app;
  try {
    app = await api(`/apps/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      setTitle(t('detail.not_found_title'));
      replace(main,
        el('h1', {}, t('detail.not_found_title')),
        el('p', {}, t('detail.not_found')),
        el('p', {}, el('a', { href: '/' }, t('common.back_to_apps'))));
      return;
    }
    throw err;
  }

  setTitle(app.name);
  const user = await getMe().catch(() => null);

  let action = null;
  if (!app.is_active) {
    action = notice(t('detail.not_available'));
  } else if (user && user.role === 'parent') {
    action = el('div', { class: 'stack' }, await parentPlayLinks(app), parentGrant(app));
  } else if (user && user.role === 'school_admin') {
    action = el('p', {}, el('a', { class: 'btn', href: '/school' }, t('detail.grant_to_children')));
  } else if (!user) {
    action = el('p', { class: 'muted' }, t('detail.parents_and_schools'),
      el('a', { href: `/login?next=${encodeURIComponent(location.pathname)}` }, t('common.sign_in').toLowerCase()),
      t('detail.to_give'));
  }

  replace(main,
    el('p', {}, el('a', { href: '/' }, t('common.all_apps'))),
    el('h1', {}, app.name),
    app.description ? el('p', {}, app.description) : null,
    details(app),
    await goalsSection(app),
    action);
}
