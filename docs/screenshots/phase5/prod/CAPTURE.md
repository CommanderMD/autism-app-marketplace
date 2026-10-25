# Phase 5 production screenshots (signed out)

Captured against **production** — `https://autism.techsmartinc.com` — immediately
after deploy of version `6fffd455-ab2b-48f8-ae9a-52c0f4f2621e`
(2026-10-25T01:17:51Z), while signed out. No account was created, no child was
created, and nothing was written to production D1 for these images.
Production measured `users 0 / children 0 / usage 0` before and after the capture.

Method: headless Google Chrome, `--window-size=1440,1000`, 6 s virtual time budget,
`--host-resolver-rules` pinning the hostname to the edge IP because this Mac's
local resolver had not yet picked up the new custom domain (the authoritative
answer from 1.1.1.1 was already correct). No browser automation beyond
`--screenshot` / `--dump-dom`; nothing clicked, nothing typed, no session.

| file | URL | what it shows |
|---|---|---|
| `home.png` | `/` | The public storefront, signed out: header with Apps / Sign in, the app list container, and the JavaScript notice. |
| `login.png` | `/login` | The sign-in page: email + password, "Create an account instead", and the EN/ES switcher. |
| `parent.png` | `/parent` | Redirects to `/login` when signed out. Identical to `login.png` by design. |
| `admin.png` | `/admin` | Redirects to `/login` when signed out. Identical to `login.png` by design. |

`parent.png` and `admin.png` being byte-identical to `login.png` is the correct
result, not a capture failure: both routes redirect an anonymous visitor to the
sign-in page, and the sign-in page is fully static for a signed-out visitor. Each
page's rendered text was dumped separately to confirm what it drew:

- `/` → "Autism App Marketplace … This site needs JavaScript to load the app list and dashboards."
- `/login` → "Sign in … Email Password Sign in Create an account instead"
- `/parent` → "Sign in … Email Password Sign in Create an account instead"
- `/admin` → "Sign in … Email Password Sign in Create an account instead"

To reproduce:

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --hide-scrollbars --no-first-run \
  --user-data-dir=/tmp/chrome-shot-prod --window-size=1440,1000 \
  --host-resolver-rules="MAP autism.techsmartinc.com <edge-ip>" \
  --virtual-time-budget=6000 \
  --screenshot=docs/screenshots/phase5/prod/home.png \
  "https://autism.techsmartinc.com/"
```

Authenticated surfaces (parent dashboard with a real child, school dashboard,
admin console) were **not** captured here on purpose: production must stay at
zero users until real onboarding. Their authenticated screenshots already exist
from Phase 3 and Phase 5 on local D1 — see `../CAPTURE.md`.
