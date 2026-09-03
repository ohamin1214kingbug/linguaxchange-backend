// The point of these checks is that the app keeps returning 200 while a core
// path is dead. So the tests assert the failure shapes, not the happy path —
// a health check that cannot fail is the bug it was written to prevent.

const originalFetch = global.fetch
const originalEnv = { ...process.env }

function loadModule() {
  jest.resetModules()
  return require('../utils/healthChecks')
}

afterEach(() => {
  global.fetch = originalFetch
  process.env = { ...originalEnv }
})

describe('checkEmail', () => {
  it('fails when the sending domain is not verified', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ data: [{ name: 'linguaxchange.com', status: 'failed' }] })
    })

    const { checkEmail } = loadModule()
    const r = await checkEmail()

    expect(r.ok).toBe(false)
    // The alert email is the whole product here — it has to explain itself.
    expect(r.detail).toContain('failed')
    expect(r.detail).toContain('email is not being delivered')
  })

  it('passes when the domain is verified', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ data: [{ name: 'linguaxchange.com', status: 'verified' }] })
    })

    const { checkEmail } = loadModule()
    expect((await checkEmail()).ok).toBe(true)
  })

  it('fails when the domain is missing from the account entirely', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    global.fetch = async () => ({ ok: true, json: async () => ({ data: [] }) })

    const { checkEmail } = loadModule()
    const r = await checkEmail()
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('not registered')
  })

  it('fails rather than throwing when Resend is unreachable', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    global.fetch = async () => { throw new Error('ECONNREFUSED') }

    const { checkEmail } = loadModule()
    const r = await checkEmail()
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('ECONNREFUSED')
  })

  it('serves a cached result rather than calling Resend on every poll', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    let calls = 0
    global.fetch = async () => {
      calls++
      return { ok: true, json: async () => ({ data: [{ name: 'linguaxchange.com', status: 'verified' }] }) }
    }

    const { checkEmail } = loadModule()
    await checkEmail(1000)
    const second = await checkEmail(1000 + 60_000)   // one minute later

    expect(calls).toBe(1)
    expect(second.cached).toBe(true)
  })

  it('re-checks once the cache has expired', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    let calls = 0
    global.fetch = async () => {
      calls++
      return { ok: true, json: async () => ({ data: [{ name: 'linguaxchange.com', status: 'verified' }] }) }
    }

    const { checkEmail } = loadModule()
    await checkEmail(1000)
    await checkEmail(1000 + 11 * 60_000)             // past the 10 minute window

    expect(calls).toBe(2)
  })
})

describe('checkGoogleOAuth', () => {
  it('fails when Google says the client was deleted', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client'
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    // Google answers 200 with the error named in the page body, so a status
    // check alone would have called this healthy.
    global.fetch = async () => ({ text: async () => '<html>deleted_client</html>' })

    const { checkGoogleOAuth } = loadModule()
    const r = await checkGoogleOAuth()
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('deleted_client')
  })

  it('passes when Google serves the normal sign-in page', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client'
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    global.fetch = async () => ({ text: async () => '<html>Sign in with Google</html>' })

    const { checkGoogleOAuth } = loadModule()
    expect((await checkGoogleOAuth()).ok).toBe(true)
  })

  it('skips rather than fails when no client id is configured', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID

    const { checkGoogleOAuth } = loadModule()
    const r = await checkGoogleOAuth()
    expect(r.ok).toBe(true)
    expect(r.skipped).toBe(true)
  })
})

describe('runHealthChecks', () => {
  it('reports every failing check, not just the first', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client'
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    global.fetch = async url => {
      if (String(url).includes('resend.com')) {
        return { ok: true, json: async () => ({ data: [{ name: 'linguaxchange.com', status: 'failed' }] }) }
      }
      return { text: async () => '<html>deleted_client</html>' }
    }

    const { runHealthChecks } = loadModule()
    const r = await runHealthChecks()

    expect(r.ok).toBe(false)
    expect(r.failing).toEqual(expect.arrayContaining(['email', 'google']))
  })
})

// Added after the outage this check exists to catch: on 2026-08-31 the commit
// that made credit changes atomic shipped code calling spend_credit and
// add_credit, but its migration was never applied. For three days every join,
// refund and attendance confirmation failed with PGRST202 while this endpoint
// reported healthy, because nothing here touched the functions.
describe('checkCreditRpcs', () => {
  const load = stub => {
    jest.resetModules()
    jest.doMock('@supabase/supabase-js', () => ({ createClient: () => stub }))
    return require('../utils/healthChecks')
  }

  afterEach(() => { jest.resetModules(); jest.restoreAllMocks() })

  test('passes when both functions answer', async () => {
    const { checkCreditRpcs } = load({ rpc: async () => ({ data: null, error: null }) })
    const r = await checkCreditRpcs()
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('spend_credit')
    expect(r.detail).toContain('add_credit')
  })

  test('fails, naming the function, when one is missing', async () => {
    // The real shape of the 2026-08-31 outage.
    const { checkCreditRpcs } = load({
      rpc: async fn => fn === 'spend_credit'
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.spend_credit' } }
        : { data: null, error: null }
    })
    const r = await checkCreditRpcs()
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('spend_credit')
    expect(r.detail).toContain('PGRST202')
    // The alert has to say what it means, not just what failed.
    expect(r.detail).toMatch(/join, refund and attendance/i)
  })

  test('fails when both are missing, naming both', async () => {
    const { checkCreditRpcs } = load({
      rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'not found' } })
    })
    const r = await checkCreditRpcs()
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('spend_credit')
    expect(r.detail).toContain('add_credit')
  })

  test('reports a thrown error rather than passing', async () => {
    const { checkCreditRpcs } = load({ rpc: async () => { throw new Error('ECONNREFUSED') } })
    const r = await checkCreditRpcs()
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('ECONNREFUSED')
  })

  test('probes a user id that cannot match, so nothing is written', async () => {
    const calls = []
    const { checkCreditRpcs } = load({
      rpc: async (fn, args) => { calls.push({ fn, args }); return { data: null, error: null } }
    })
    await checkCreditRpcs()
    expect(calls).toHaveLength(2)
    for (const c of calls) {
      expect(c.args.p_amount).toBe(0)
      expect(c.args.p_user_id).toBeLessThan(0)
    }
  })
})

// Added after two intermittent 503s on 2026-09-03 that left no diagnosable
// trace: the endpoint reported which check failed in its response body, but
// cron-job.org's free tier does not store bodies, and Railway's logs were
// empty because withTimeout returned the reason without writing it down.
describe('timeout visibility and Google caching', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  const load = () => { jest.resetModules(); return require('../utils/healthChecks') }

  afterEach(() => {
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    jest.restoreAllMocks()
  })

  test('the Google check is cached, so it does not re-download 884KB every run', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client'
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    let calls = 0
    global.fetch = async () => { calls++; return { text: async () => '<html>Sign in</html>' } }

    const { checkGoogleOAuth } = load()
    await checkGoogleOAuth(1000)
    const second = await checkGoogleOAuth(1000 + 10 * 60_000)   // ten minutes later

    expect(calls).toBe(1)
    expect(second.cached).toBe(true)
  })

  test('it re-checks once the cache window has passed', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client'
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    let calls = 0
    global.fetch = async () => { calls++; return { text: async () => '<html>Sign in</html>' } }

    const { checkGoogleOAuth } = load()
    await checkGoogleOAuth(1000)
    await checkGoogleOAuth(1000 + 31 * 60_000)

    expect(calls).toBe(2)
  })

  test('a rejected client is cached too — a real failure should not be re-fetched every run', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client'
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    let calls = 0
    global.fetch = async () => { calls++; return { text: async () => '<html>deleted_client</html>' } }

    const { checkGoogleOAuth } = load()
    const first = await checkGoogleOAuth(1000)
    const second = await checkGoogleOAuth(1000 + 60_000)

    expect(first.ok).toBe(false)
    expect(second.ok).toBe(false)
    expect(calls).toBe(1)
  })

  test('an unreachable Google is NOT cached, so a blip cannot pin a false negative', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client'
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    let calls = 0
    global.fetch = async () => { calls++; throw new Error('ETIMEDOUT') }

    const { checkGoogleOAuth } = load()
    await checkGoogleOAuth(1000)
    await checkGoogleOAuth(1000 + 60_000)

    // Both calls hit the network: a transient failure must not stick.
    expect(calls).toBe(2)
  })
})
