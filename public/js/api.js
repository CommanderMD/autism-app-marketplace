// Fetch wrapper for the same-origin JSON API.
// - Always sends the session cookie (credentials: 'same-origin').
// - Never caches: responses can contain child records.
// - Non-2xx becomes an ApiError carrying the status and the API's message.

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const FALLBACK_MESSAGES = {
  401: 'You are not signed in.',
  403: 'You do not have access to this.',
  404: 'Not found.',
  429: 'Too many attempts. Wait a minute and try again.',
};

export async function api(path, { method = 'GET', body } = {}) {
  const init = {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }

  const type = response.headers.get('Content-Type') || '';
  const data = type.includes('application/json') ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const message = (data && typeof data.error === 'string' && data.error)
      || FALLBACK_MESSAGES[response.status]
      || `Request failed (${response.status}).`;
    throw new ApiError(response.status, message, data);
  }
  if (data === null) throw new ApiError(response.status, 'The server sent an unexpected response.');
  return data;
}
