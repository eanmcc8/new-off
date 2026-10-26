# ms-session

A small HTTP service that logs into a Microsoft account via headless Chromium and returns the resulting OAuth tokens and session cookies.

It is the container-port of the original `test2pup.js` Netlify function: same login flow, same token interception, same response shape. The only thing that changed is the shell — Express instead of Netlify's `exports.handler`.

- **Login flow:** automated via Puppeteer (real Chromium, two-step email → password).
- **Output:** OAuth tokens (`access_token`, `refresh_token`, `id_token`) **and** Microsoft auth cookies (`ESTSAUTH`, `ESTSAUTHPERSISTENT`, `ESTSECAUTH`, …).
- **Designed for:** an account you own — personal automation, tenant testing, OAuth exploration. Not for use against accounts that aren't yours.

---

## Requirements

- **Node 22+** (local) or **Docker** (recommended)
- **Chromium** — installed automatically in the Docker image; `apt install chromium` for local
- **A Microsoft account** whose password you control
- **~512 MB RAM minimum** (Chromium needs ~350 MB; 512 MB works for single-user logins)

---

## What it produces

```json
{
  "success": true,
  "sessionData": {
    "version": "2.0",
    "getdAt": "2026-01-01T00:00:00.000Z",
    "source": "puppeteer-container",
    "email": "you@tenant.com",
    "domain": "login.microsoftonline.com",
    "oauth": {
      "access_token": "eyJ0eXAi...",
      "refresh_token": "M.C5...",
      "id_token": "eyJ0eXAi...",
      "token_type": "Bearer",
      "expires_in": 3599,
      "scope": "openid profile email",
      "expires_at": 1735689600000
    },
    "cookies": [
      { "name": "ESTSAUTH",            "value": "...", "domain": ".login.microsoftonline.com", "path": "/", "secure": true, "httpOnly": true, "sameSite": "None", "session": true },
      { "name": "ESTSAUTHPERSISTENT", "value": "...", "domain": ".login.microsoftonline.com", "path": "/", "secure": true, "httpOnly": true, "sameSite": "None", "session": false }
    ],
    "totalCookies": 7,
    "metadata": {
      "tokensgetd": true,
      "cookiesgetd": true,
      "getdTokenNames": ["access_token", "refresh_token", "id_token", "token_type", "expires_in", "scope"]
    }
  },
  "cookies": [ "…same array…" ],
  "totalCookies": 7,
  "domain": "login.microsoftonline.com",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "source": "puppeteer-container",
  "getdCookies": ["ESTSAUTH", "ESTSAUTHPERSISTENT", "ESTSECAUTH", "…"],
  "oauth": { "…same object…" },
  "metadata": { "…same object…" }
}