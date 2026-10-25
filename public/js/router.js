// Path -> view mapping, and the shell's entry point.
//
// Every UI path is served the same shell (index.html, or one of its
// fallback copies), which loads this module. It picks the view from
// location.pathname, loads it with import(), and renders it into <main>.
// If the module or the API fails, the user sees an honest error, never a blank page.
import { ApiError } from './api.js';
import { getMe, dashboardFor, loginUrl, signOut } from './session.js';
import { el, replace, notice } from './ui.js';
import { initI18n, t, languageSwitcher } from './i18n.js';

// Route titles are i18n keys (see /i18n/en.json "titles").
const ROUTES = [
  { pattern: /^\/$/, module: './views/storefront.js', title: 'titles.apps' },
  { pattern: /^\/app\/([^/]+)$/, module: './views/app-detail.js', title: 'titles.app_details' },
  { pattern: /^\/login$/, module: './views/login.js', title: 'titles.sign_in' },
  { pattern: /^\/parent$/, module: './views/parent.js', title: 'titles.parent' },
  { pattern: /^\/school$/, module: './views/school.js', title: 'titles.school' },
  { pattern: /^\/admin$/, module: './views/admin.js', title: 'titles.admin' },
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
  const site = t('common.site');
  document.title = title ? `${title} - ${site}` : site;
}

function renderError(main, title, message, links = []) {
  setTitle(title);
  replace(main,
    el('h1', { tabindex: '-1' }, title),
    notice(message, { error: true }),
    links.length ? el('p', {}, links.flatMap((l, i) => [i ? ' · ' : '', el('a', { href: l.href }, l.label)])) : null);
}

export function renderNotFound(main) {
  renderError(main, t('errors.not_found_title'), t('errors.not_found'), [{ href: '/', label: t('common.back_to_apps') }]);
}

// Turns any failure into a visible message. 401/403 get specific guidance.
export function renderFailure(main, err) {
  if (err instanceof ApiError && err.status === 401) {
    renderError(main, t('errors.sign_in_title'), t('errors.sign_in'),
      [{ href: loginUrl(location.pathname + location.search), label: t('common.sign_in') }]);
  } else if (err instanceof ApiError && err.status === 403) {
    renderError(main, t('errors.no_access_title'), t('errors.no_access'),
      [{ href: '/', label: t('common.back_to_apps') }]);
  } else {
    const message = err instanceof ApiError ? err.message : t('errors.wrong');
    renderError(main, t('errors.wrong_title'), message,
      [{ href: location.pathname + location.search, label: t('common.try_again') }, { href: '/', label: t('common.back_to_apps') }]);
  }
}

// Static shell text carries data-i18n="key"; translated in place after the
// language is known. English stays in the HTML as the no-JS fallback.
function translateStatic() {
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
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
      el('li', {}, el('a', { href: dashboardFor(user.role) }, t('common.dashboard'))),
      el('li', {}, el('button', { type: 'button', class: 'link', onClick: () => signOut() }, t('common.sign_out'))));
  }
  list.append(el('li', { class: 'nav-lang' }, languageSwitcher()));
  for (const link of list.querySelectorAll('a')) {
    if (normalizePath(new URL(link.href).pathname) === path) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

async function boot() {
  const main = document.getElementById('main');
  const status = document.getElementById('page-status');
  await initI18n().catch(() => { /* English strings are the built-in fallback */ });
  translateStatic();
  const route = resolve(location.pathname);
  enhanceNav(route ? route.path : normalizePath(location.pathname));

  if (!route) {
    renderNotFound(main);
    return;
  }

  setTitle(t(route.title));
  status.textContent = t('common.loading');

  let view;
  try {
    view = await import(route.module);
  } catch {
    status.textContent = '';
    renderError(main, t('errors.load_title'), t('errors.load'),
      [{ href: location.pathname + location.search, label: t('common.reload') }, { href: '/', label: t('common.back_to_apps') }]);
    return;
  }

  try {
    await view.render({ main, params: route.params, setTitle, status });
    if (status.textContent === t('common.loading')) status.textContent = '';
  } catch (err) {
    status.textContent = '';
    renderFailure(main, err);
  }
}

// Only boot in a browser page that has the shell markup.
if (typeof document !== 'undefined' && document.getElementById('main')) boot();
