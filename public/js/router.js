// Path -> view mapping, and the shell's entry point.
//
// Every UI path is served the same shell (index.html, or one of its
// fallback copies), which loads this module. It picks the view from
// location.pathname, loads it with import(), and renders it into <main>.
// If the module or the API fails, the user sees an honest error, never a blank page.
import { ApiError } from './api.js';
import { getMe, dashboardFor, loginUrl, signOut } from './session.js';
import { el, replace, notice } from './ui.js';

const SITE = 'Autism App Marketplace';

const ROUTES = [
  { pattern: /^\/$/, module: './views/storefront.js', title: 'Apps' },
  { pattern: /^\/app\/([^/]+)$/, module: './views/app-detail.js', title: 'App details' },
  { pattern: /^\/login$/, module: './views/login.js', title: 'Sign in' },
  { pattern: /^\/parent$/, module: './views/parent.js', title: 'Parent dashboard' },
  { pattern: /^\/school$/, module: './views/school.js', title: 'School dashboard' },
  { pattern: /^\/admin$/, module: './views/admin.js', title: 'Platform admin' },
];

// '/parent.html', '/parent/', '/index.html' all resolve like their clean path.
export function normalizePath(pathname) {
  let path = pathname.replace(/\/+$/, '') || '/';
  path = path.replace(/\.html$/, '');
  if (path === '/index') path = '/';
  return path;
}

export function resolve(pathname) {
  const path = normalizePath(pathname);
  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (match) {
      let params;
      try {
        params = match.slice(1).map(decodeURIComponent);
      } catch {
        return null;
      }
      return { ...route, params, path };
    }
  }
  return null;
}

export function setTitle(title) {
  document.title = title ? `${title} - ${SITE}` : SITE;
}

function renderError(main, title, message, links = []) {
  setTitle(title);
  replace(main,
    el('h1', { tabindex: '-1' }, title),
    notice(message, { error: true }),
    links.length ? el('p', {}, links.flatMap((l, i) => [i ? ' · ' : '', el('a', { href: l.href }, l.label)])) : null);
}

export function renderNotFound(main) {
  renderError(main, 'Page not found', 'There is no page at this address.', [{ href: '/', label: 'Back to all apps' }]);
}

// Turns any failure into a visible message. 401/403 get specific guidance.
export function renderFailure(main, err) {
  if (err instanceof ApiError && err.status === 401) {
    renderError(main, 'Please sign in', 'Your session has ended or you are not signed in.',
      [{ href: loginUrl(location.pathname + location.search), label: 'Sign in' }]);
  } else if (err instanceof ApiError && err.status === 403) {
    renderError(main, 'No access', 'Your account does not have access to this page.',
      [{ href: '/', label: 'Back to all apps' }]);
  } else {
    const message = err instanceof ApiError ? err.message : 'Something went wrong while showing this page.';
    renderError(main, 'Something went wrong', message,
      [{ href: location.pathname + location.search, label: 'Try again' }, { href: '/', label: 'Back to all apps' }]);
  }
}

// Adds "Dashboard" and "Sign out" for a signed-in user and marks the current page.
async function enhanceNav(path) {
  const list = document.querySelector('.site-nav ul');
  if (!list) return;
  let user = null;
  try {
    user = await getMe();
  } catch {
    // The nav still works signed-out; the view reports its own errors.
  }
  if (user) {
    const signIn = list.querySelector('[data-nav="sign-in"]');
    if (signIn) signIn.remove();
    list.append(
      el('li', {}, el('a', { href: dashboardFor(user.role) }, 'Dashboard')),
      el('li', {}, el('button', { type: 'button', class: 'link', onClick: () => signOut() }, 'Sign out')));
  }
  for (const link of list.querySelectorAll('a')) {
    if (normalizePath(new URL(link.href).pathname) === path) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

async function boot() {
  const main = document.getElementById('main');
  const status = document.getElementById('page-status');
  const route = resolve(location.pathname);
  enhanceNav(route ? route.path : normalizePath(location.pathname));

  if (!route) {
    renderNotFound(main);
    return;
  }

  setTitle(route.title);
  status.textContent = 'Loading…';

  let view;
  try {
    view = await import(route.module);
  } catch {
    status.textContent = '';
    renderError(main, 'This page could not be loaded',
      'Part of the page failed to download. Check your connection and reload.',
      [{ href: location.pathname + location.search, label: 'Reload' }, { href: '/', label: 'Back to all apps' }]);
    return;
  }

  try {
    await view.render({ main, params: route.params, setTitle, status });
    if (status.textContent === 'Loading…') status.textContent = '';
  } catch (err) {
    status.textContent = '';
    renderFailure(main, err);
  }
}

// Only boot in a browser page that has the shell markup.
if (typeof document !== 'undefined' && document.getElementById('main')) boot();
