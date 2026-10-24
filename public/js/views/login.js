// Sign in / register. The mode is in the URL (?mode=register). After a
// successful sign-in the user goes to ?next= if it is a same-origin path,
// otherwise to their role's dashboard.
import { api } from '../api.js';
import { getMe, dashboardFor, safeNext } from '../session.js';
import { el, replace, field, setFieldError, notice } from '../ui.js';

const MIN_PASSWORD = 10;

function currentMode() {
  return new URLSearchParams(location.search).get('mode') === 'register' ? 'register' : 'signin';
}

function setMode(mode) {
  const url = new URL(location.href);
  if (mode === 'register') url.searchParams.set('mode', 'register');
  else url.searchParams.delete('mode');
  history.replaceState(null, '', url.pathname + url.search);
}

function destination(user) {
  const next = safeNext(new URLSearchParams(location.search).get('next'), null);
  // Never bounce back to the login page itself.
  if (next && !/^\/login(\.html)?(\?|#|$)/.test(next)) return next;
  return dashboardFor(user.role);
}

// Puts an API error next to the field it is about; otherwise in the form slot.
// The message is shown verbatim; it never contains the password.
function showError(fields, formError, message) {
  const key = /invite/i.test(message) ? 'invite' : /password/i.test(message) ? 'password' : /email/i.test(message) ? 'email' : null;
  const target = key && fields[key] && !fields[key].wrap.hidden ? fields[key] : null;
  if (target) {
    setFieldError(target, message);
    target.input.focus();
  } else {
    formError.textContent = message;
  }
}

export async function render({ main, setTitle }) {
  const user = await getMe().catch(() => null);

  function draw(mode, focusHeading = false, initialError = '') {
    const registering = mode === 'register';
    const title = registering ? 'Create an account' : 'Sign in';
    setTitle(title);

    const fields = {
      email: field({ label: 'Email', name: 'email', type: 'email', required: true, autocomplete: 'email', spellcheck: 'false' }),
      password: field({
        label: 'Password', name: 'password', type: 'password', required: true,
        autocomplete: registering ? 'new-password' : 'current-password',
        hint: registering ? `At least ${MIN_PASSWORD} characters.` : null,
        minlength: registering ? String(MIN_PASSWORD) : null,
      }),
    };
    if (registering) {
      fields.role = field({
        label: 'I am a', name: 'role', kind: 'select',
        options: [{ value: 'parent', label: 'Parent or carer' }, { value: 'school_admin', label: 'School administrator' }],
      });
      fields.invite = field({
        label: 'Invite code', name: 'invite_code', autocomplete: 'off', spellcheck: 'false',
        hint: 'Optional. If a colleague gave you a code, enter it to join their school.',
      });
      fields.school = field({ label: 'School name', name: 'school_name', hint: 'A new school is created with this name.' });
    }

    // school_admin: invite code shown; school name only when there is no code.
    function syncRegisterFields() {
      if (!registering) return;
      const admin = fields.role.input.value === 'school_admin';
      fields.invite.wrap.hidden = !admin;
      fields.school.wrap.hidden = !admin || fields.invite.input.value.trim() !== '';
    }
    if (registering) {
      fields.role.input.addEventListener('change', syncRegisterFields);
      fields.invite.input.addEventListener('input', syncRegisterFields);
      syncRegisterFields();
    }

    const formError = el('p', { class: 'form-error', role: 'alert' }, initialError);
    const submit = el('button', { type: 'submit' }, registering ? 'Create account' : 'Sign in');
    const form = el('form', { novalidate: true }, Object.values(fields).map((f) => f.wrap), formError, submit);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      for (const f of Object.values(fields)) setFieldError(f, '');
      formError.textContent = '';
      submit.disabled = true;
      const email = fields.email.input.value;
      const password = fields.password.input.value;
      let registered = false;
      try {
        if (registering) {
          const role = fields.role.input.value;
          const body = { email, password, role };
          if (role === 'school_admin') {
            const code = fields.invite.input.value.trim().toUpperCase();
            if (code) body.invite_code = code;
            else if (fields.school.input.value.trim()) body.school_name = fields.school.input.value.trim();
          }
          await api('/auth/register', { method: 'POST', body });
          registered = true;
        }
        const signedIn = await api('/auth/login', { method: 'POST', body: { email, password } });
        location.assign(destination(signedIn));
      } catch (err) {
        if (registered) {
          // The account exists now; registering again would fail. Switch to sign in.
          setMode('signin');
          draw('signin', true, `Your account was created, but signing in failed: ${err.message}`);
          return;
        }
        fields.password.input.value = '';
        showError(fields, formError, err.message);
        submit.disabled = false;
      }
    });

    const toggle = el('button', { type: 'button', class: 'secondary' },
      registering ? 'I already have an account' : 'Create an account instead');
    toggle.addEventListener('click', () => {
      const next = registering ? 'signin' : 'register';
      setMode(next);
      draw(next, true);
    });

    replace(main,
      el('h1', { tabindex: '-1' }, title),
      user ? notice('You are already signed in.', {
        children: el('p', {}, el('a', { href: dashboardFor(user.role) }, 'Go to your dashboard')),
      }) : null,
      el('div', { class: 'panel' }, form),
      el('p', {}, toggle));

    if (focusHeading) main.querySelector('h1').focus();
  }

  draw(currentMode());
}
