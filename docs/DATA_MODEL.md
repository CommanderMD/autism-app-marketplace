# Data Model: accounts, ownership, and child records

## Summary

- **Adults have accounts. Children never do.**
- `users` is the only table holding credentials. Each user has exactly one role:
  `parent`, `school_admin`, or `platform_admin`.
- A child is a **record** in `children`, owned by a parent (`parent_id`), a
  school (`school_id`), or both. Every read or write of a child goes through an
  adult's session and is filtered by ownership in the SQL `WHERE` clause.
- Sessions live in Workers KV (`SESSIONS`), not in D1.

## Tables (after `migrations/003_auth.sql`)

```
schools (id PK)
   ▲             ▲
   │ school_id   │ school_id
users (id PK, email UNIQUE, password_hash, role CHECK(...))
   ▲
   │ id  (same value: a parent-role user's parents row has id = users.id)
parents (id PK → users.id)
   ▲
   │ parent_id
children (id PK, parent_id → parents.id, school_id → schools.id)
   ▲
   ├── child_app_access (child_id → children.id, app_id → apps.id, granted_by = users.id)
   └── app_usage        (child_id → children.id, app_id → apps.id)
```

| Table | Role |
|---|---|
| `users` | Auth identity: email, PBKDF2 password hash, role, optional `school_id`. |
| `parents` | Profile for a `parent` user. Same `id` as the user row. |
| `schools` | School organisation. A `school_admin` user points at one via `users.school_id`. |
| `children` | Child record. No email, no password, no login. |
| `child_app_access` | Which apps a child may use; `granted_by` records the adult user who granted it. |
| `app_usage` | Per-session usage/progress for a child. |

## Who can see which child

| Caller role | Rows visible in `children` | SQL filter |
|---|---|---|
| `parent` | Children they own | `parent_id = :user_id` |
| `school_admin` | Children enrolled in their school | `school_id = :user_school_id` |
| `platform_admin` | All | none |
| not signed in | None (401) | n/a |

Ownership is set from the session at creation time, never from the request body:

- A parent creating a child becomes its `parent_id`. `parent_id` in the body is ignored.
- A school admin creating a child sets `school_id` to their own school.
- A parent cannot attach a child to a school they are not linked to, and a
  school admin cannot attach a child to another school (both return 403).

`GET /api/children/:id` returns 403 when the child exists but belongs to someone
else and 404 when it does not exist. The existence check only returns a boolean;
no columns of another family's or school's child are read.

## Why children have no credentials

### COPPA (Children's Online Privacy Protection Act)

COPPA applies to online services that collect personal information from
children under 13. It requires verifiable parental consent *before* collection,
and gives parents the right to review and delete their child's data.

Our users are autistic children, many under 13. Giving a child an account would
mean collecting the child's own email or username and password, which is
personal information collected *from the child*. That is exactly what COPPA
regulates, and it would make the child, rather than the adult, the party
who controls the account.

Instead:

- The **adult** registers, agrees to the terms, and holds the credential.
- The adult creates the child's record and chooses which apps the child gets.
  This is the parental consent and control point.
- We collect the minimum about the child: a display name, plus optional birth
  date (used for age-appropriate app matching) and school link.
- The adult can see everything we hold about their child through their own
  session, which supports the right to review. (Delete/export endpoints are
  planned for a later phase.)

### FERPA (Family Educational Rights and Privacy Act)

When a school enrols a student, the records the school creates or directs
(app access and usage/progress data) can be education records under FERPA.
The school controls their disclosure, and they may only be shared with parties
the school authorises.

Instead:

- A child linked by `school_id` is visible to that school's `school_admin`
  users and to no other school. Cross-school reads return 403, and cross-school
  creation is refused.
- A school admin cannot pick an existing `school_id` at registration. Each
  `school_admin` registration creates a new, empty school, so nobody can join an
  existing school and read its students' records by self-registering. Adding
  staff to an existing school will need an invitation flow (a later phase).
- `platform_admin` exists for operations and support only. It cannot be
  self-registered and must be provisioned directly in the database by an
  operator.

### Security reasons

- **No child credential means no child account to phish, guess, or take over.**
- Children's devices are often shared. A child can't leak a password they
  don't have.
- Account recovery, lockout and password reset flows all target adults, who
  can actually complete them.
- Every audit trail (`child_app_access.granted_by`) points at an accountable adult.

## How a child uses an app

A child never signs in. An adult opens the app in a session they control (the
parent's device, or a classroom device the school manages), and the app acts on
behalf of that child record. If kid-facing devices later need their own access,
it should be a short-lived, revocable, device-scoped token minted by the adult
for one child, with no password and no PII. It must not be a `users` row.

## Credentials and sessions

- Passwords: PBKDF2-SHA256, 100,000 iterations (the Workers runtime maximum),
  random 16-byte salt per user, stored as
  `pbkdf2$sha256$<iterations>$<b64salt>$<b64hash>`. Verification uses a
  constant-time comparison. See `src/auth/password.js`.
- Sessions: 32 random bytes (hex) as the id. KV key `session:<id>`, value
  `{userId, role, createdAt}`, 7-day TTL. Cookie `__Host-sid`, flags
  `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`.
- Login: 10 attempts per minute per IP (KV counter `ratelimit:login:<ip>`).
  Failed logins wait about 1 second and return the same message whether or not
  the email exists.

## Test data rule (A4)

No real child data in fixtures, seeds or logs. Use obviously fake names
such as "Test Child A" and `@example.test` addresses.
