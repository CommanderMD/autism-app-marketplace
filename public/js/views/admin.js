// Platform admin: apps (including inactive), schools, and assigning a
// school_admin to a school. Every mutation re-fetches the affected list.
import { api } from '../api.js';
import { requireRole } from '../session.js';
import { el, replace, field, setFieldError, liveRegion, announce, busy, table, ageRange } from '../ui.js';

// Shows an API validation error next to the field it names ("age_min must
// be ..."), or in the form-level slot if no field matches.
function showError(fields, formError, message) {
  const name = message.match(/^(\w+) /)?.[1];
  const target = name && fields[name];
  if (target) {
    setFieldError(target, message);
    target.input.focus();
  } else {
    formError.textContent = message;
  }
}

function clearErrors(fields, formError) {
  for (const f of Object.values(fields)) setFieldError(f, '');
  formError.textContent = '';
}

// '' -> omitted; a number -> number; anything else is sent as typed so the
// API's own validation message comes back.
function optionalInt(value) {
  if (value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function appsSection() {
  const live = liveRegion();
  const area = el('div', {});

  async function load(focusSelector) {
    const apps = await api('/api/admin/apps');
    replace(area, table({
      caption: 'All apps, including inactive',
      columns: [
        { label: 'Name', key: 'name' },
        { label: 'ID', key: 'id' },
        { label: 'Category', key: 'category' },
        { label: 'Ages', render: ageRange },
        { label: 'Difficulty', key: 'difficulty_level', num: true },
        {
          label: 'Status',
          render: (a) => el('span', { class: a.is_active ? 'badge active' : 'badge inactive' }, a.is_active ? 'Active' : 'Inactive'),
        },
        { label: 'Action', render: (a) => toggleButton(a) },
      ],
      rows: apps,
      rowAttrs: (a) => ({ class: a.is_active ? null : 'is-inactive' }),
    }));
    if (focusSelector) area.querySelector(focusSelector)?.focus();
  }

  function toggleButton(app) {
    const deactivate = Boolean(app.is_active);
    const button = el('button', {
      type: 'button',
      class: deactivate ? 'danger' : 'secondary',
      dataset: { app: app.id },
    }, deactivate ? 'Deactivate' : 'Activate', el('span', { class: 'visually-hidden' }, ` ${app.name}`));
    button.addEventListener('click', () => {
      if (deactivate && !confirm(`Deactivate ${app.name}? It disappears from the public store and cannot be granted.`)) {
        announce(live, 'Nothing was changed.');
        return;
      }
      busy(button, async () => {
        try {
          await api(`/api/admin/apps/${encodeURIComponent(app.id)}`, { method: 'PATCH', body: { is_active: !deactivate } });
          announce(live, `${app.name} is now ${deactivate ? 'inactive' : 'active'}.`);
          await load(`button[data-app="${CSS.escape(app.id)}"]`);
        } catch (err) {
          announce(live, err.message);
        }
      });
    });
    return button;
  }

  const fields = {
    name: field({ label: 'Name', name: 'name', required: true }),
    id: field({ label: 'ID', name: 'id', hint: 'Optional. Lowercase letters, digits and dashes. Made from the name if empty.' }),
    category: field({ label: 'Category', name: 'category', required: true }),
    subcategory: field({ label: 'Subcategory', name: 'subcategory' }),
    description: field({ label: 'Description', name: 'description', kind: 'textarea' }),
    age_min: field({ label: 'Minimum age', name: 'age_min', inputmode: 'numeric' }),
    age_max: field({ label: 'Maximum age', name: 'age_max', inputmode: 'numeric' }),
    difficulty_level: field({ label: 'Difficulty (1-5)', name: 'difficulty_level', inputmode: 'numeric' }),
  };
  const formError = el('p', { class: 'form-error', role: 'alert' });
  const submit = el('button', { type: 'submit' }, 'Create app');
  const form = el('form', { class: 'panel', novalidate: true },
    el('h3', {}, 'Create an app'),
    Object.values(fields).map((f) => f.wrap), formError, submit);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(fields, formError);
    const v = (k) => fields[k].input.value;
    const body = {
      name: v('name'),
      category: v('category'),
      id: v('id').trim() || undefined,
      subcategory: v('subcategory').trim() || undefined,
      description: v('description').trim() || undefined,
      age_min: optionalInt(v('age_min')),
      age_max: optionalInt(v('age_max')),
      difficulty_level: optionalInt(v('difficulty_level')),
    };
    busy(submit, async () => {
      try {
        const app = await api('/api/admin/apps', { method: 'POST', body });
        form.reset();
        announce(live, `Created ${app.name}.`);
        await load();
      } catch (err) {
        if (err.status === 409) {
          setFieldError(fields.id, err.message);
          fields.id.input.focus();
        } else {
          showError(fields, formError, err.message);
        }
      }
    });
  });

  return {
    load,
    node: el('section', { 'aria-labelledby': 'apps-heading' },
      el('h2', { id: 'apps-heading' }, 'Apps'), live, area, form),
  };
}

function schoolsSection() {
  const live = liveRegion();
  const area = el('div', {});
  const assignLive = liveRegion();
  const assignArea = el('div', {});

  async function load() {
    const schools = await api('/api/admin/schools');
    replace(area, schools.length
      ? table({
        caption: 'Schools',
        columns: [
          { label: 'Name', key: 'name' },
          { label: 'ID', key: 'id' },
          { label: 'Created', key: 'created_at' },
        ],
        rows: schools,
      })
      : el('p', {}, 'No schools yet.'));
    replace(assignArea, assignForm(schools));
  }

  function assignForm(schools) {
    if (schools.length === 0) return el('p', {}, 'Create a school first.');
    const userId = field({ label: 'User ID', name: 'user_id', required: true, autocomplete: 'off', hint: 'The id of a user whose role is school_admin.' });
    const school = field({ label: 'School', name: 'school_id', kind: 'select', options: schools.map((s) => ({ value: s.id, label: s.name })) });
    const submit = el('button', { type: 'submit' }, 'Assign');
    const form = el('form', { novalidate: true }, userId.wrap, school.wrap, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setFieldError(userId, '');
      const id = userId.input.value.trim();
      if (!id) {
        setFieldError(userId, 'User ID is required.');
        userId.input.focus();
        return;
      }
      const schoolName = school.input.selectedOptions[0]?.textContent;
      busy(submit, async () => {
        try {
          await api(`/api/admin/users/${encodeURIComponent(id)}/school`, { method: 'POST', body: { school_id: school.input.value } });
          announce(assignLive, `User ${id} is now an admin of ${schoolName}.`);
        } catch (err) {
          announce(assignLive, err.message);
        }
      });
    });
    return form;
  }

  const name = field({ label: 'School name', name: 'name', required: true });
  const email = field({ label: 'Contact email', name: 'contact_email', type: 'email', hint: 'Optional.' });
  const formError = el('p', { class: 'form-error', role: 'alert' });
  const submit = el('button', { type: 'submit' }, 'Create school');
  const form = el('form', { class: 'panel', novalidate: true }, el('h3', {}, 'Create a school'), name.wrap, email.wrap, formError, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors({ name, contact_email: email }, formError);
    busy(submit, async () => {
      try {
        const created = await api('/api/admin/schools', {
          method: 'POST', body: { name: name.input.value, contact_email: email.input.value.trim() || null },
        });
        form.reset();
        announce(live, `Created ${created.name}.`);
        await load();
      } catch (err) {
        showError({ name, contact_email: email }, formError, err.message);
      }
    });
  });

  return {
    load,
    node: [
      el('section', { 'aria-labelledby': 'schools-heading' },
        el('h2', { id: 'schools-heading' }, 'Schools'), live, area, form),
      el('section', { 'aria-labelledby': 'assign-heading' },
        el('h2', { id: 'assign-heading' }, 'Assign a school admin'), assignLive, assignArea),
    ],
  };
}

export async function render({ main, setTitle }) {
  const user = await requireRole('platform_admin');
  if (!user) return;
  setTitle('Platform admin');

  const apps = appsSection();
  const schools = schoolsSection();
  replace(main, el('h1', {}, 'Platform admin'), apps.node, schools.node);
  await Promise.all([apps.load(), schools.load()]);
}
