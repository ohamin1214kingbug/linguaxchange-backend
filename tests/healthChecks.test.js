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
