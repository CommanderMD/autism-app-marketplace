// Phase 5 security pass: response headers and the same-origin rule.
//
// Headers: the Kemet-OS set that the techsmartinc.com zone already applies at
// the edge (so autism.techsmartinc.com inherits it), set here too so the
// workers.dev hostname, local dev and the tests all see the same headers, plus
// a Content-Security-Policy that the edge rule does not carry. Every byte the
// Worker serves - JSON, the gate's HTML, static assets - goes through
// withSecurityHeaders().
//
// Origin: the API is same-origin only. There is no CORS allow list because
// nothing outside this origin is meant to call it. A state-changing request
// that arrives with a foreign Origin (or Sec-Fetch-Site: cross-site) is
// refused before any handler runs, which is also the CSRF guard for the
// cookie session. Requests without an Origin header (curl, tests, same-origin
// navigations) are unaffected.

export const SECURITY_HEADERS = Object.freeze({
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Empire-Layer': 'Kemet-OS-Security-v1',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  // No inline script or style anywhere in public/: every <script> and <style>
  // is a file under this origin, and style changes from JS go through the
  // CSSOM (element.style.x = ...), which CSP does not block. No third party is
  // ever loaded. HSTS (above) handles the https upgrade, so there is no
  // upgrade-insecure-requests here: it would break `wrangler dev` on localhost.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
});

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PROTECTED_PREFIXES = ['/api', '/auth'];

function isProtected(path) {
  return PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

// null when the request may proceed, otherwise a Response to return instead.
export function enforceSameOrigin(request, url) {
  const path = url.pathname;
  if (!isProtected(path)) return null;

  if (request.method === 'OPTIONS') {
    // No CORS grant for anyone: a preflight gets the methods but never an
    // Access-Control-Allow-Origin, so the browser refuses the real request.
    return new Response(null, { status: 204, headers: { Allow: 'GET, POST, PUT, PATCH, DELETE' } });
  }
  if (!MUTATING.has(request.method)) return null;

  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) {
    return jsonRefusal('Cross-origin request refused');
  }
  const site = request.headers.get('Sec-Fetch-Site');
  if (site === 'cross-site') {
    return jsonRefusal('Cross-site request refused');
  }
  return null;
}

function jsonRefusal(message) {
  return new Response(JSON.stringify({ error: message }), { status: 403, headers: { 'Content-Type': 'application/json' } });
}

// Copies the response (fetch() and HTMLRewriter responses have immutable
// headers) and sets the security headers. API and auth responses also get
// Cache-Control: no-store unless the handler chose otherwise, so no child
// record is ever written to a browser or proxy cache.
export function withSecurityHeaders(response, url) {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  if (isProtected(url.pathname) && !out.headers.has('Cache-Control')) {
    out.headers.set('Cache-Control', 'no-store');
  }
  // The Worker never identifies its runtime to the client.
  out.headers.delete('Server');
  out.headers.delete('X-Powered-By');
  return out;
}
