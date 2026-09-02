const { createClient } = require('@supabase/supabase-js')

// Built on first use rather than at import. Importing a module should not
// construct a client, and doing so made this file impossible to require in a
// test without real credentials in the environment.
let client
function db() {
  if (!client) client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  return client
}

// Health checks for the paths that have failed silently in production.
//
// Every one of these corresponds to a real outage, not a hypothetical:
//   - Resend's sending domain sat unverified from the day the feature
//     shipped until 2026-09-01. Every password reset in the site's history
//     failed to send, and nobody knew.
//   - The SPF and MX records for that domain were deleted from the DNS zone
//     mid-evening on 2026-09-01 while an unrelated record was being added,
//     which put the domain straight back to failed.
//   - The Google OAuth client is one misclick away from deletion, and its
//     console page puts Delete next to the fields you actually edit.
//
// What they have in common is that the application keeps returning 200 while
// broken. Nothing throws. That is why this is an endpoint someone else polls
// rather than a try/catch somewhere.

const TIMEOUT_MS = 5000

// A check that hangs is worse than one that fails: the poller times out with
// no information about which dependency is bad.
//
// The timer is cleared once the race settles. Without that, every poll leaves
// a live 5-second handle behind — harmless in a long-running server, but it
// keeps the event loop alive and stops a test run from exiting, which is how
// it was noticed.
async function withTimeout(promise, label) {
  let timer
  const timeout = new Promise(resolve => {
    timer = setTimeout(
      () => resolve({ ok: false, detail: `${label} timed out after ${TIMEOUT_MS}ms` }),
      TIMEOUT_MS
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

// Resend's domain status is the authoritative answer to "can this site send
// email at all". Checking DNS directly would catch a record deletion sooner,
// but it answers a different question — Resend can still refuse a domain
// whose records resolve, which is exactly the state this project was in for
// several hours on 2026-09-01.
//
// Cached: the poller runs every few minutes and this status changes on the
// order of hours. ponytail: module-level cache, fine for one process; if this
// ever runs on several instances they each keep their own, which is harmless.
let resendCache = { at: 0, result: null }
const RESEND_CACHE_MS = 10 * 60 * 1000

async function checkEmail(now = Date.now()) {
  if (resendCache.result && now - resendCache.at < RESEND_CACHE_MS) {
    return { ...resendCache.result, cached: true }
  }

  let result
  try {
    if (!process.env.RESEND_API_KEY) {
      result = { ok: false, detail: 'RESEND_API_KEY is not set' }
    } else {
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
      })
      if (!res.ok) {
        result = { ok: false, detail: `Resend API returned ${res.status}` }
      } else {
        const { data } = await res.json()
        const domain = (data || []).find(d => d.name === 'linguaxchange.com')
        if (!domain) {
          result = { ok: false, detail: 'linguaxchange.com is not registered with Resend' }
        } else if (domain.status !== 'verified') {
          // The whole point of this check. Say the status out loud so the
          // alert email explains itself without anyone opening a dashboard.
          result = { ok: false, detail: `sending domain status is "${domain.status}", not "verified" — email is not being delivered` }
        } else {
          result = { ok: true, detail: 'sending domain verified' }
        }
      }
    }
  } catch (e) {
    result = { ok: false, detail: `could not reach Resend: ${e.message}` }
  }

  resendCache = { at: now, result }
  return result
}

// Catches the OAuth client being deleted, or its secret rotated out from
// under Supabase. Google answers anonymously, so no credentials are needed.
//
// Known gap: this CANNOT detect the app being switched back to Testing
// status, which on 2026-09-01 was silently blocking every student who was
// not on the test-user list. Google exposes publishing status only through
// an authenticated admin API, and an anonymous request looks identical
// either way. Do not read a passing check here as "Google sign-in works".
async function checkGoogleOAuth() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!clientId) return { ok: true, detail: 'skipped — GOOGLE_OAUTH_CLIENT_ID not set', skipped: true }

  try {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', `${process.env.SUPABASE_URL}/auth/v1/callback`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'email')

    const res = await fetch(url, { redirect: 'follow' })
    const body = await res.text()

    // Google returns 200 with the error named in the page for a dead client,
    // so the status code alone proves nothing.
    for (const marker of ['deleted_client', 'invalid_client', 'OAuth client was not found']) {
      if (body.includes(marker)) {
        return { ok: false, detail: `Google rejected the OAuth client: ${marker}` }
      }
    }
    return { ok: true, detail: 'OAuth client accepted by Google' }
  } catch (e) {
    return { ok: false, detail: `could not reach Google: ${e.message}` }
  }
}

async function checkDatabase() {
  try {
    // Cheapest query that still proves the connection and credentials work:
    // a primary-key lookup that is allowed to return nothing.
    const { error } = await db().from('users').select('id').limit(1)
    if (error) return { ok: false, detail: `database error: ${error.message}` }
    return { ok: true, detail: 'reachable' }
  } catch (e) {
    return { ok: false, detail: `could not reach the database: ${e.message}` }
  }
}

// Runs every check and reports all of them, rather than stopping at the first
// failure — when two things break together, the alert should say so.
async function runHealthChecks() {
  const [email, google, database] = await Promise.all([
    withTimeout(checkEmail(), 'email'),
    withTimeout(checkGoogleOAuth(), 'google'),
    withTimeout(checkDatabase(), 'database')
  ])

  const checks = { email, google, database }
  const failing = Object.entries(checks).filter(([, c]) => !c.ok).map(([name]) => name)

  return {
    ok: failing.length === 0,
    failing,
    checks,
    checkedAt: new Date().toISOString()
  }
}

// Exported for the test, which must not depend on the module-level cache
// surviving between cases.
function _resetCache() {
  resendCache = { at: 0, result: null }
}

module.exports = { runHealthChecks, checkEmail, checkGoogleOAuth, checkDatabase, _resetCache }
