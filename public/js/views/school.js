// School dashboard: roster (GET /api/children, scoped to this school by the
// API), bulk grant, 7-day usage table, CSV export link, and invite codes.
import { api } from '../api.js';
import { requireRole } from '../session.js';
import { el, replace, field, liveRegion, announce, busy, notice, table } from '../ui.js';

function rosterForm(children, apps, onGranted) {
  const live = liveRegion();
  if (children.length === 0) {
    return el('div', {}, el('p', {}, 'No children on your roster yet.'));
  }

  const boxes = children.map((child) => el('input', { type: 'checkbox', name: 'child', value: child.id }));
  const selectAll = el('input', { type: 'checkbox', name: 'select-all' });

  function syncSelectAll() {
    const checked = boxes.filter((b) => b.checked).length;
    selectAll.checked = checked === boxes.length;
    selectAll.indeterminate = checked > 0 && checked < boxes.length;
  }
  selectAll.addEventListener('change', () => {
    for (const b of boxes) b.checked = selectAll.checked;
    syncSelectAll();
  });
  for (const b of boxes) b.addEventListener('change', syncSelectAll);

  const app = field({
    label: 'App to grant', name: 'app', kind: 'select',
    options: apps.map((a) => ({ value: a.id, label: a.name })),
  });
  const submit = el('button', { type: 'submit' }, 'Grant to selected children');

  const form = el('form', { novalidate: true },
    el('fieldset', { class: 'panel' },
      el('legend', {}, 'Children'),
      el('label', { class: 'check' }, selectAll, el('strong', {}, 'Select all')),
      el('ul', { class: 'check-list' }, children.map((child, i) =>
        el('li', {}, el('label', { class: 'check' }, boxes[i], child.name))))),
    el('div', { class: 'form-row' }, app.wrap, submit),
    live);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const ids = boxes.filter((b) => b.checked).map((b) => b.value);
    if (ids.length === 0) {
      announce(live, 'Select at least one child first.');
      return;
    }
    const appName = app.input.selectedOptions[0]?.textContent;
    busy(submit, async () => {
      try {
        const res = await api('/api/school/children/apps', {
          method: 'POST', body: { app_id: app.input.value, child_ids: ids },
        });
        announce(live, `${appName}: granted to ${res.granted}, already had it: ${res.already_granted}.`);
      } catch (err) {
        announce(live, err.message);
        return;
      }
      await onGranted().catch((err) => announce(live, `Granted, but the usage table could not refresh: ${err.message}`));
    });
  });

  return form;
}

// Active grant counts for the first APP_COUNT_LIMIT children, one request
// each; children beyond the cap, or whose request fails, show '—'.
const APP_COUNT_LIMIT = 50;

async function appCounts(children) {
  const counts = await Promise.all(children.slice(0, APP_COUNT_LIMIT).map((c) =>
    api(`/api/children/${encodeURIComponent(c.id)}/apps`).then((apps) => apps.length, () => '—')));
  return children.map((_, i) => (i < counts.length ? counts[i] : '—'));
}

// Every roster child gets a row, so a child with no usage shows 0 rather than
// silently disappearing from the table.
function usageTable(children, summary, counts) {
  const byChild = new Map(summary.by_child.map((r) => [r.child_id, r]));
  const rows = children.map((c, i) => ({
    name: c.name,
    apps: counts[i],
    minutes: byChild.get(c.id)?.minutes || 0,
    activities: byChild.get(c.id)?.activities || 0,
  }));
  return el('div', {},
    el('p', {}, `School total: ${summary.totals.minutes} min and ${summary.totals.activities} activities in the last 7 days.`),
    rows.length
      ? table({
        caption: 'Usage per child, last 7 days',
        columns: [
          { label: 'Child', key: 'name' },
          { label: 'Apps', key: 'apps', num: true },
          { label: 'Minutes', key: 'minutes', num: true },
          { label: 'Activities', key: 'activities', num: true },
        ],
        rows,
      })
      : el('p', {}, 'No children on your roster yet.'));
}

function invites() {
  const live = liveRegion();
  const result = el('div', { class: 'panel', hidden: true });
  const create = el('button', { type: 'submit' }, 'Create invite code');
  const form = el('form', {},
    el('p', {}, 'An invite code lets another staff member register as an admin of your school.'),
    create);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    busy(create, async () => {
      try {
        // Empty body: the API creates a school_admin invite, which is what the
        // registration form accepts.
        const invite = await api('/api/school/invites', { method: 'POST' });
        const code = el('output', { class: 'invite-code', 'aria-label': `Invite code ${invite.code.split('').join(' ')}` }, invite.code);
        const copy = el('button', { type: 'button', class: 'secondary' }, 'Copy code');
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(invite.code);
            announce(live, 'Code copied.');
          } catch {
            announce(live, 'Copy is not available here. Select the code and copy it manually.');
          }
        });
        replace(result,
          el('p', {}, 'Share this code. It works once.'),
          code,
          el('p', {}, `Expires ${invite.expires_at} UTC.`),
          copy);
        result.hidden = false;
        announce(live, `Invite code created: ${invite.code.split('').join(' ')}. Expires ${invite.expires_at} UTC.`);
      } catch (err) {
        announce(live, err.message);
      }
    });
  });

  return el('div', {}, form, live, result);
}

export async function render({ main, setTitle }) {
  const user = await requireRole('school_admin');
  if (!user) return;
  setTitle('School dashboard');

  if (!user.school_id) {
    replace(main, el('h1', {}, 'School dashboard'),
      notice('Your account is not linked to a school yet. Ask a platform admin to assign one.', { error: true }));
    return;
  }

  const rosterArea = el('div', {});
  const usageArea = el('div', {});

  async function loadUsage(children) {
    const [summary, counts] = await Promise.all([
      api(`/api/usage/summary?school_id=${encodeURIComponent(user.school_id)}`),
      appCounts(children),
    ]);
    replace(usageArea, usageTable(children, summary, counts));
  }

  // After a bulk grant only the usage table is redrawn, so the roster's
  // checkboxes and its live announcement stay put.
  async function load() {
    const [children, apps] = await Promise.all([api('/api/children'), api('/apps')]);
    replace(rosterArea, rosterForm(children, apps, () => loadUsage(children)));
    await loadUsage(children);
  }

  replace(main,
    el('h1', {}, 'School dashboard'),
    el('section', { 'aria-labelledby': 'roster-heading' },
      el('h2', { id: 'roster-heading' }, 'Roster and bulk grant'),
      rosterArea),
    el('section', { 'aria-labelledby': 'usage-heading' },
      el('h2', { id: 'usage-heading' }, 'Usage, last 7 days'),
      usageArea,
      el('p', {}, el('a', { class: 'btn secondary', href: '/api/school/usage.csv', download: true }, 'Download usage CSV'))),
    el('section', { 'aria-labelledby': 'invites-heading' },
      el('h2', { id: 'invites-heading' }, 'Invite codes'),
      invites()));

  await load();
}
