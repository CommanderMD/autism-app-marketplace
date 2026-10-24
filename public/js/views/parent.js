// Parent dashboard. Every child shown comes from GET /api/children (the API
// scopes it to this parent); every mutation re-fetches from the API rather
// than patching local state.
import { api } from '../api.js';
import { requireRole } from '../session.js';
import { el, replace, field, setFieldError, liveRegion, announce, busy, notice, uniqueId } from '../ui.js';

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

  async function refresh(focusSelector) {
    const [children, apps] = await Promise.all([api('/api/children'), api('/apps')]);
    const summaries = await Promise.all(children.map((c) =>
      api(`/api/usage/summary?child_id=${encodeURIComponent(c.id)}`).catch((err) => err)));
    replace(list, children.length
      ? children.map((child, i) => childCard(child, summaries[i], apps))
      : el('p', {}, 'No children added yet. Use the form above to add one.'));
    if (focusSelector) list.querySelector(focusSelector)?.focus();
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

  function childCard(child, summary, apps) {
    const sel = `[data-child="${CSS.escape(child.id)}"]`;
    const headingId = uniqueId('child');

    const grant = field({ label: 'App to grant', name: 'grant-app', kind: 'select', options: appOptions(apps) });
    const grantButton = el('button', { type: 'submit' }, 'Grant');
    const grantForm = el('form', { class: 'form-row' }, grant.wrap, grantButton);
    grantForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const appName = grant.input.selectedOptions[0]?.textContent;
      mutate(grantButton, async () => {
        await api(`/api/children/${encodeURIComponent(child.id)}/apps`, { method: 'POST', body: { app_id: grant.input.value } });
        return `${appName} granted to ${child.name}.`;
      }, `${sel} select[name="grant-app"]`);
    });

    const revoke = field({ label: 'App to remove', name: 'revoke-app', kind: 'select', options: appOptions(apps) });
    const revokeButton = el('button', { type: 'submit', class: 'danger' }, 'Remove access');
    const revokeForm = el('form', { class: 'form-row' }, revoke.wrap, revokeButton);
    revokeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const appName = revoke.input.selectedOptions[0]?.textContent;
      if (!confirm(`Remove ${appName} from ${child.name}?`)) {
        announce(live, 'Nothing was removed.');
        return;
      }
      mutate(revokeButton, async () => {
        await api(`/api/children/${encodeURIComponent(child.id)}/apps/${encodeURIComponent(revoke.input.value)}`, { method: 'DELETE' });
        return `${appName} removed from ${child.name}.`;
      }, `${sel} select[name="revoke-app"]`);
    });

    return el('section', { class: 'card', dataset: { child: child.id }, 'aria-labelledby': headingId },
      el('h2', { id: headingId, tabindex: '-1' }, child.name),
      el('dl', { class: 'dl' }, el('dt', {}, 'Birth date'), el('dd', {}, child.birth_date || 'not set')),
      el('h3', {}, 'Last 7 days'),
      usage(summary),
      el('h3', {}, 'Give an app'),
      grantForm,
      el('h3', {}, 'Remove an app'),
      revokeForm);
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
