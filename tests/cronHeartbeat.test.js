// Written for a specific outage: "Send Class Reminders" ran last on
// 2026-07-31 and was found dead on 2026-09-02. Its secret had drifted, every
// call 401'd, the scheduler disabled the job, and nothing reported it. These
// assert the states that outage passed through.

const originalEnv = { ...process.env }

// Minimal Supabase stand-in — enough for .from().select().eq().maybeSingle()
// and .from().upsert().
function fakeSupabase({ row, error, onUpsert }) {
  return {
    from() {
      return {
        select() { return this },
        eq() { return this },
        maybeSingle: async () => ({ data: row ?? null, error: error ?? null }),
        upsert: async payload => { onUpsert && onUpsert(payload); return { error: error ?? null } }
      }
    }
  }
}

function loadWith(stub) {
  jest.resetModules()
  jest.doMock('@supabase/supabase-js', () => ({ createClient: () => stub }))
  return require('../utils/cronHeartbeat')
}

afterEach(() => {
  jest.resetModules()
  jest.restoreAllMocks()
  process.env = { ...originalEnv }
})

describe('checkHeartbeat', () => {
  const now = new Date('2026-09-02T12:00:00Z').getTime()

  it('passes when the job ran recently', () => {
    const recent = new Date(now - 6 * 60_000).toISOString()   // 6 minutes ago
    const { checkHeartbeat } = loadWith(fakeSupabase({ row: { last_run_at: recent } }))
    return checkHeartbeat('send-class-reminders', now).then(r => {
      expect(r.ok).toBe(true)
      expect(r.detail).toContain('6 minutes ago')
    })
  })

  it('fails once the job has been silent past the threshold', () => {
    const stale = new Date(now - 45 * 60_000).toISOString()   // 45 minutes ago
    const { checkHeartbeat } = loadWith(fakeSupabase({ row: { last_run_at: stale } }))
    return checkHeartbeat('send-class-reminders', now).then(r => {
      expect(r.ok).toBe(false)
      expect(r.detail).toContain('45 minutes')
      // The alert has to say what to go and look at.
      expect(r.detail).toContain('scheduler may be disabled')
    })
  })

  it('fails on the exact outage: five weeks of silence', () => {
    const july31 = new Date('2026-07-31T00:00:00Z').toISOString()
    const { checkHeartbeat } = loadWith(fakeSupabase({ row: { last_run_at: july31 } }))
    return checkHeartbeat('send-class-reminders', now).then(r => {
      expect(r.ok).toBe(false)
    })
  })

  it('fails rather than passes when no run was ever recorded', () => {
    // A job that never starts leaves no row. Treating that as healthy would
    // reproduce the original bug in the monitoring itself.
    const { checkHeartbeat } = loadWith(fakeSupabase({ row: null }))
    return checkHeartbeat('send-class-reminders', now).then(r => {
      expect(r.ok).toBe(false)
      expect(r.detail).toContain('has ever been recorded')
    })
  })

  it('reports a database error instead of throwing', () => {
    const { checkHeartbeat } = loadWith(fakeSupabase({ row: null, error: { message: 'connection refused' } }))
    return checkHeartbeat('send-class-reminders', now).then(r => {
      expect(r.ok).toBe(false)
      expect(r.detail).toContain('connection refused')
    })
  })
})

describe('recordRun', () => {
  it('writes the job name and a timestamp', async () => {
    let written
    const { recordRun } = loadWith(fakeSupabase({ onUpsert: p => { written = p } }))
    await recordRun('send-class-reminders')
    expect(written.job).toBe('send-class-reminders')
    expect(Date.parse(written.last_run_at)).not.toBeNaN()
  })

  it('never throws when the write fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const { recordRun } = loadWith(fakeSupabase({ error: { message: 'table missing' } }))
    // A failed monitoring write must not fail the cron run that just sent
    // real reminders.
    await expect(recordRun('send-class-reminders')).resolves.toBeUndefined()
  })
})
