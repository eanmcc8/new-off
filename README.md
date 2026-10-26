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
      { "name": "ESTSAUTH",           "value": "...", "domain": ".login.microsoftonline.com", "path": "/", "secure": true, "httpOnly": true, "sameSite": "None", "session": true },
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
```

Legacy top-level keys are preserved alongside the nested `sessionData` object so any existing caller of the original Netlify function keeps working after switching to `POST /login`.

---

## Setup

### Local (Node 22+)

```bash
sudo apt update && sudo apt install -y chromium

git clone <repo> ms-session && cd ms-session
npm install
npm start
```

If `puppeteer` tries to download its own Chromium and you'd rather use the system one:

```bash
export PUPPETEER_EXECUTABLE_PATH=$(which chromium)
export PUPPETEER_SKIP_DOWNLOAD=1
npm install
npm start
```

### Docker (recommended)

```bash
docker build -t ms-session .
docker run -d --name ms-session --restart unless-stopped -p 3000:3000 ms-session
```

---

## Usage

```bash
curl -X POST http://localhost:3000/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@tenant.com","password":"your-password"}'
```

Returns the JSON shape above. `success: true` means the flow completed; check `oauth.access_token` to see whether tokens were actually issued.

### Using the tokens

```bash
curl https://graph.microsoft.com/v1.0/me \
  -H "Authorization: Bearer $ACCESS_TOKEN"

curl -X POST https://login.microsoftonline.com/common/oauth2/v2.0/token \
  -d "grant_type=refresh_token" \
  -d "refresh_token=$REFRESH_TOKEN" \
  -d "client_id=4eea8b9a-09d9-47dd-87c7-78de0d9f42be"
```

### Using the cookies

Import the `cookies` array into your browser or a tool like EditThisCookie to restore the Microsoft session in a browser you control. Set the domain to `.login.microsoftonline.com` and `.office.com` as shown in the cookie objects.

---

## Deploy

### Oracle Cloud Always Free (recommended)

1. Create an Oracle Cloud account, spin up a **VM.Standard.A1.Flex** instance (Ubuntu 22.04).
2. Open port 3000 in the **VCN Security List** (or put a reverse proxy on 80/443 in front).
3. SSH in and run:

```bash
sudo apt update && sudo apt install -y docker.io
sudo systemctl enable --now docker

git clone <repo> ms-session && cd ms-session
sudo docker build -t ms-session .
sudo docker run -d --name ms-session --restart unless-stopped -p 3000:3000 ms-session
```

4. Verify:

```bash
curl http://<instance-public-ip>:3000/health
```

For TLS, put **Caddy** in front:

```
example.com {
  reverse_proxy localhost:3000
}
```

### Render (free tier, easier setup, cold starts)

1. Push the repo to GitHub.
2. Render dashboard → **New** → **Web Service** → connect the repo.
3. Render auto-detects the `Dockerfile`. Pick the free plan.
4. De reportedploy.

Free-tier caveats:

- 750 hours/month
- Spins down after 15 min idle → 30–60 s cold start on first request
- 512 MB RAM (tight; single-user logins work, concurrency does not)

### Other hosts that work

| Host | Free tier | Notes |
|---|---|---|
| Koyeb | 1 service / 512 MB | Same cold-start caveat as Render |
| Fly.io | Not really free | 256 MB shared instance can't hold Chromium; minimum 1 GB is paid |
| Railway | $5 credit | Credit runs out in days with browser workloads |

---

## API

### `POST /login`

Request:

```json
{ "email": "string", "password": "string" }
```

Responses:

| Status | Body |
|---|---|
| `200` | Full session object (see **What it produces**) |
| `400` | `{ "success": false, "error": "Email and password required" }` |
| `500` | `{ "success": false, "error": "…", "errorType": "…", "sessionData": null, "cookies": [], "totalCookies": 0, "oauth": null }` |

### `GET /health`

```json
{ "ok": true }
```

Useful for load balancer health checks and uptime monitoring.

### CORS

`Access-Control-Allow-Origin: *` and `POST, OPTIONS` are set on every response. If you plan to expose this beyond localhost, see **Security** below.

---

## Configuration

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `PUPPETEER_EXECUTABLE_PATH` | (Puppeteer's bundled path) | Override to use system Chromium |
| `PUPPETEER_SKIP_DOWNLOAD` | (unset) | Set to `1` to skip the ~200 MB browser download at `npm install` |

### Login URL constants

At the top of `server.js`:

```javascript
const LOGIN_URL =
  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' +
  '?client_id=4eea8b9a-09d9-47dd-87c7-78de0d9f42be' +
  '&response_type=code' +
  '&redirect_uri=https%3A%2F%2Fwww.office.com%2F' +
  '&scope=openid%20profile%20email&state=get'
```

`client_id=4eea8b9a-…` is the Office.com public client that the original script targeted. To target your own Azure app instead:

1. Register an app in **Microsoft Entra ID → App registrations**.
2. Add a redirect URI (web or SPA).
3. Replace the `client_id` and `redirect_uri` here.

This is optional — the default works for the original script's use case.

---

## What changed from the original `test2pup.js`

**Bugs fixed (2):**

- `page.waitForTimeout(10000)` → `new Promise(r => setTimeout(r, 10000))` — the original API was removed in Puppeteer 22+; without this, the script throws on any modern install.
- `browser.close()` moved to `finally` — the original leaked a Chromium process on every error, which OOMs a container after ~20 failures.

**Silent bugs also fixed (3):**

- `session: !cookie.expires` → `session: cookie.expires === -1` — Chrome DevTools Protocol reports `-1` for session cookies, and `!(-1)` is `false`, so the original always `session: false`.
- `res.headers()['content-type']` null-guarded with `|| ''` — the original could throw `TypeError: undefined.includes`.
- `store.getItem(k)` null-checked before `JSON.parse` — the original could crash on a null entry.

**Architecture (required by the port):**

- `exports.handler(event)` → `app.post('/login', req, res)`
- CORS headers → `cors()` middleware (same values)
- `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` in the Dockerfile — uses system Chromium instead of the downloaded binary

**Cleanup (behavior unchanged):**

- Launch flags cut 9 → 4 (dropped `--disable-web-security`, `--no-zygote`, `--no-first-run`, `--disable-accelerated-2d-canvas`, `--disable-features=VizDisplayCompositor`; kept the four that matter for Linux containers)
- Logging reduced from ~30 lines per call to 2 on success, 1 on failure

**Preserved exactly:** login URL, two-step flow, both token endpoint patterns (`oauth2/v2.0/token` and `token_endpoint`), cookie filter regex, localStorage/sessionStorage fallback, `expires_at` math, all response keys including legacy duplicates and `getd*` names.

---

## Known limitations

### MFA blocks the flow

If the account has MFA enabled, the password step succeeds but Microsoft issues no token — you get `success: true` with `oauth.access_token: null`. There is no way around this without a human in the loop; Microsoft's login is designed to stop password-only automation when MFA is on.

To fail loudly instead of returning a misleading success, add this line before the `return` in `loginAndGetSession`:

```javascript
if (!oauth.access_token && cookies.length === 0) {
  throw new Error('Login did not complete — likely MFA challenge or invalid credentials')
}
```

### Conditional access / unusual activity

Microsoft may block the login based on IP reputation, device fingerprint, or tenant policy. Symptoms: `waitForSelector` times out, or the token exchange never fires. This is Microsoft's detection working as designed, not a bug in this service. It is more likely to happen on cloud-hosted IPs than on a residential connection.

### 10-second fixed wait

The script sleeps 10 s after submitting the password. This is generous — long enough for most redirect chains — but slow for quick accounts and sometimes too short for slow ones. If you see frequent `oauth.access_token: null` failures, increase it. If you want lower latency, replace the sleep with:

```javascript
await page.waitForFunction(
  () => document.cookie.includes('ESTSAUTH'),
  { timeout: 20000 }
)
```

### No concurrency limit

Each `/login` call opens its own browser. Ten simultaneous requests = ten Chromium processes. On 512 MB hosts this OOMs. On Oracle's 24 GB box it's fine up to ~15 concurrent. For anything beyond that, add a queue (e.g. `p-queue` with `concurrency: 3`).

---

## Security

This service handles **passwords and session tokens in plaintext**. Understand the risk before exposing it:

- Run only on a host you control. Never expose this publicly without authentication in front.
- Add auth. For anything beyond localhost, put Cloudflare Access, a reverse proxy with basic auth, or an API key check in front of `/login`. Example middleware:

```javascript
app.use((req, res, next) => {
  if (req.path === '/health') return next()
  const key = req.headers['x-api-key']
  if (key !== process.env.API_KEY) return res.status(401).json({ error: 'unauthorized' })
  next()
})
```

- Logs include the email address. Set `LOG_LEVEL=warn` if you don't want it. `console.log('[login] start ${email}')` in `server.js` is where it comes from.
- `Access-Control-Allow-Origin: *` is intentional but permissive. Narrow it to your frontend's origin if you have one.
- The Microsoft account you use should be a test or throwaway. Not your primary account with MFA and conditional access policies.

### Acceptable use

Use this against accounts you own, or with written authorization from the account owner. Automating logins on accounts that aren't yours — even if you have the password — is against Microsoft's Universal Terms of Service and may be illegal depending on your jurisdiction. This service is provided for personal automation and OAuth exploration on your own tenant.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `browser.close is not a function` | Puppeteer version too old or too new | Ensure `puppeteer@23.x`; the `finally { browser.close() }` guard handles the launch-failure case |
| Container starts, `/login` returns 500 immediately | Chromium missing or `PUPPETEER_EXECUTABLE_PATH` wrong | `apt install chromium` and set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` |
| `waitForSelector` times out | Microsoft presented a different page (MFA, "help us protect your account", captcha) | Check the login flow manually in a browser first; these flows can't be automated |
| `oauth.access_token: null` | MFA, invalid password, or conditional access block | See **Known limitations** |
| 500s after ~20 calls on Render | Chromium process leak from before the `finally` fix | Rebuild image — the fixed code closes the browser on every path |
| OOM after a few concurrent calls | 512 MB host can't hold multiple Chromiums | Move to Oracle, or add a queue with `concurrency: 3` |

---

## Files

```
ms-session/
├── server.js
├── package.json
├── Dockerfile
├── .dockerignore
└── README.md
```

One file. No build step. No TypeScript. No `dist/`.

---

## License

MIT. See `LICENSE`.