// Parent dashboard. Every child shown comes from GET /api/children (the API
// scopes it to this parent); every mutation re-fetches from the API rather
// than patching local state.
import { api } from '../api.js';
import { requireRole } from '../session.js';
import { el, replace, field, setFieldError, liveRegion, announce, busy, notice, uniqueId, table } from '../ui.js';

const DAY_MS = 86_400_000;

// The 7 UTC dates the API summarises (today and the 6 days before), oldest first.
function lastSevenDays() {
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  return Array.from({ length: 7 }, (_, i) => new Date(today - (6 - i) * DAY_MS).toISOString().slice(0, 10));
}

function dayLabel(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

function minutes(n) {
  return `${n} min`;
}

function usage(summary) {
  if (summary instanceof Error) return notice(`Usage could not be loaded: ${summary.message}`, { error: true });
  const { totals, by_app: byApp, by_day: byDay } = summary;
  if (!totals.minutes && !totals.activities) return el('p', {}, 'No usage in the last 7 days yet.');

  const perDay = new Map(byDay.map((d) => [d.date, d.minutes || 0]));
  const days = lastSevenDays();
  const max = Math.max(1, ...days.map((d) => perDay.get(d) || 0));

  return el('div', {},
    el('p', {}, `${minutes(totals.minutes)} and ${totals.activities} activities in the last 7 days.`),
    el('h4', {}, 'By app'),
    el('ul', {}, byApp.map((a) => el('li', {}, `${a.app_name || a.app_id}: ${minutes(a.minutes)}, ${a.activities} activities`))),
    el('h4', {}, 'By day (minutes)'),
    el('ul', { class: 'bars' }, days.map((d) => {
      const value = perDay.get(d) || 0;
      return el('li', {},
        el('span', {}, dayLabel(d)),
        el('span', { class: 'bar-track', 'aria-hidden': 'true' },
          el('span', { class: 'bar-fill', style: `display:block;width:${Math.round((value / max) * 100)}%` })),
        el('span', { class: 'value' }, minutes(value)));
    })));
}

// granted_at is a UTC 'YYYY-MM-DD HH:MM:SS' timestamp; only the date is shown.
function grantedLabel(grantedAt) {
  const date = String(grantedAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '-';
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function appOptions(apps) {
  return apps.map((a) => ({ value: a.id, label: a.name }));
}

export async function render({ main, setTitle }) {
  const user = await requireRole('parent');
  if (!user) return;
  setTitle('Parent dashboard');

  // Lives outside the re-rendered list, so announcements survive a refresh.
  const live = liveRegion();
  const list = el('div', { class: 'stack' });

  // focus: a selector, or a list of selectors tried in order (the first one
  // that matches after the re-render gets focus).
  async function refresh(focus) {
    const [children, apps] = await Promise.all([api('/api/children'), api('/apps')]);
    const [summaries, granted] = await Promise.all([
      Promise.all(children.map((c) =>
        api(`/api/usage/summary?child_id=${encodeURIComponent(c.id)}`).catch((err) => err))),
      Promise.all(children.map((c) =>
        api(`/api/children/${encodeURIComponent(c.id)}/apps`).catch((err) => err))),
    ]);
    replace(list, children.length
      ? children.map((child, i) => childCard(child, summaries[i], granted[i], apps))
      : el('p', {}, 'No children added yet. Use the form above to add one.'));
    for (const selector of [focus].flat().filter(Boolean)) {
      const target = list.querySelector(selector);
      if (target) { target.focus(); break; }
    }
  }

  // Runs a mutation, announces the result, and re-fetches from the API.
  async function mutate(button, task, focusSelector) {
    await busy(button, async () => {
      try {
        const message = await task();
        if (message) announce(live, message);
        await refresh(focusSelector);
      } catch (err) {
        announce(live, err.message);
      }
    });
  }

  // The child's active grants, each row with its own Remove button.
  function grantedApps(child, granted, sel) {
    if (granted instanceof Error) return notice(`Apps could not be loaded: ${granted.message}`, { error: true });
    if (granted.length === 0) return el('p', {}, 'No apps granted yet.');

    // Launch goes through the server-side gate, never to the app folder directly.
    function playLink(app) {
      return el('a', {
        class: 'btn',
        href: `/apps/${encodeURIComponent(app.app_id)}/play?child_id=${encodeURIComponent(child.id)}`,
        'aria-label': `Play ${app.name} as ${child.name}`,
      }, 'Play');
    }

    function removeButton(app) {
      const button = el('button', { type: 'button', class: 'danger', 'aria-label': `Remove ${app.name} from ${child.name}` }, 'Remove');
      button.addEventListener('click', () => {
        if (!confirm(`Remove ${app.name} from ${child.name}?`)) {
          announce(live, 'Nothing was removed.');
          return;
        }
        mutate(button, async () => {
          await api(`/api/children/${encodeURIComponent(child.id)}/apps/${encodeURIComponent(app.app_id)}`, { method: 'DELETE' });
          return `${app.name} removed from ${child.name}.`;
        }, [`${sel} [data-apps-heading]`]);
      });
      return button;
    }

    return table({
      caption: `Apps ${child.name} can use`,
      columns: [
        { label: 'App', key: 'name' },
        { label: 'Category', key: 'category' },
        { label: 'Granted', render: (a) => grantedLabel(a.granted_at) },
        { label: 'Play', render: playLink },
        { label: 'Action', render: removeButton },
      ],
      rows: granted,
    });
  }

  function childCard(child, summary, granted, apps) {
    const sel = `[data-child="${CSS.escape(child.id)}"]`;
    const headingId = uniqueId('child');

    // Only offer apps the child does not already have. If the grant list
    // failed to load, offer everything: a repeat grant is a harmless no-op.
    const have = new Set(granted instanceof Error ? [] : granted.map((g) => g.app_id));
    const grantable = apps.filter((a) => !have.has(a.id));

    let grantArea;
    if (grantable.length === 0) {
      grantArea = el('p', {}, 'This child has every app in the catalogue.');
    } else {
      const grant = field({ label: 'App to grant', name: 'grant-app', kind: 'select', options: appOptions(grantable) });
      const grantButton = el('button', { type: 'submit' }, 'Grant');
      grantArea = el('form', { class: 'form-row' }, grant.wrap, grantButton);
      grantArea.addEventListener('submit', (event) => {
        event.preventDefault();
        const appName = grant.input.selectedOptions[0]?.textContent;
        mutate(grantButton, async () => {
          await api(`/api/children/${encodeURIComponent(child.id)}/apps`, { method: 'POST', body: { app_id: grant.input.value } });
          return `${appName} granted to ${child.name}.`;
        }, [`${sel} select[name="grant-app"]`, `${sel} [data-apps-heading]`]);
      });
    }

    return el('section', { class: 'card', dataset: { child: child.id }, 'aria-labelledby': headingId },
      el('h2', { id: headingId, tabindex: '-1' }, child.name),
      el('dl', { class: 'dl' }, el('dt', {}, 'Birth date'), el('dd', {}, child.birth_date || 'not set')),
      el('h3', { tabindex: '-1', dataset: { appsHeading: '' } }, 'Apps'),
      grantedApps(child, granted, sel),
      el('h3', {}, 'Give an app'),
      grantArea,
      el('h3', {}, 'Last 7 days'),
      usage(summary));
  }

  // Add child form. API validation errors are shown next to the field they name.
  const name = field({ label: 'Name', name: 'name', required: true, autocomplete: 'off', maxlength: '200' });
  const birth = field({ label: 'Birth date', name: 'birth_date', type: 'date', hint: 'Optional. Format YYYY-MM-DD.' });
  const formError = el('p', { class: 'form-error', role: 'alert' });
  const addButton = el('button', { type: 'submit' }, 'Add child');
  const addForm = el('form', { novalidate: true }, name.wrap, birth.wrap, formError, addButton);
  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    setFieldError(name, '');
    setFieldError(birth, '');
    formError.textContent = '';
    busy(addButton, async () => {
      let created;
      try {
        created = await api('/api/children', {
          method: 'POST',
          body: { name: name.input.value, birth_date: birth.input.value || null },
        });
      } catch (err) {
        if (err.message.startsWith('birth_date')) { setFieldError(birth, err.message); birth.input.focus(); }
        else if (err.message.startsWith('name')) { setFieldError(name, err.message); name.input.focus(); }
        else formError.textContent = err.message;
        return;
      }
      addForm.reset();
      announce(live, `Added ${created.name}.`);
      await refresh(`[data-child="${CSS.escape(created.id)}"] h2`).catch((err) => announce(live, err.message));
    });
  });

  replace(main,
    el('h1', {}, 'Parent dashboard'),
    live,
    el('section', { class: 'panel', 'aria-labelledby': 'add-child-heading' },
      el('h2', { id: 'add-child-heading' }, 'Add a child'),
      addForm),
    el('section', { 'aria-labelledby': 'children-heading' },
      el('h2', { id: 'children-heading' }, 'Your children'),
      list));

  await refresh();
}
