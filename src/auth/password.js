// Password hashing with WebCrypto PBKDF2-SHA256.
// Stored format (self-describing): pbkdf2$sha256$<iterations>$<b64salt>$<b64hash>
// 100000 is the highest iteration count the Workers runtime supports for PBKDF2.

const ITERATIONS = 100000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

function toBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BITS
  );
  return new Uint8Array(bits);
}

// Constant-time comparison: always walks the full length, no early exit.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$sha256$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
  let salt, expected;
  try {
    salt = fromBase64(parts[3]);
    expected = fromBase64(parts[4]);
  } catch {
    return false;
  }
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

// A valid hash of a random value. Login verifies against this when the email
// does not exist so both paths spend the same PBKDF2 time.
let dummyHash;
export async function getDummyHash() {
  if (!dummyHash) dummyHash = await hashPassword(crypto.randomUUID());
  return dummyHash;
}
