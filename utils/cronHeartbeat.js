const { createClient } = require('@supabase/supabase-js')

// Built on first use rather than at import, so requiring this file in a test
// does not need real credentials.
let client
function db() {
  if (!client) client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  return client
}

// How long a job may go silent before the health check calls it dead.
//
// The reminder job runs every 5-10 minutes, so 30 gives it two or three
// missed ticks before anyone is woken. Long enough that a single failed run
// or a Railway restart is not an alert; short enough that the five-week
// outage this was written for would have surfaced the same morning.
const STALE_AFTER_MS = 30 * 60 * 1000

const REMINDER_JOB = 'send-class-reminders'

// Called at the end of a cron run, including runs that did nothing. That is
// the point: reminder_sent_at only moves when a reminder actually goes out,
// so a job that never runs and a job with nothing to do were previously
// indistinguishable.
//
// Never throws. A failed heartbeat write must not fail the cron run that
// just did real work — losing a reminder to a monitoring write would be a
// worse bug than the one this prevents.
async function recordRun(job) {
  try {
    const { error } = await db()
      .from('cron_heartbeat')
      .upsert({ job, last_run_at: new Date().toISOString() }, { onConflict: 'job' })
    if (error) console.error('heartbeat write failed', error)
  } catch (e) {
    console.error('heartbeat write failed', e)
  }
}

async function checkHeartbeat(job = REMINDER_JOB, now = Date.now()) {
  try {
    const { data, error } = await db()
      .from('cron_heartbeat')
      .select('last_run_at')
      .eq('job', job)
      .maybeSingle()

    if (error) return { ok: false, detail: `could not read the heartbeat: ${error.message}` }

    // No row means the job has not completed once since this was deployed.
    // Reported rather than passed: a missing heartbeat is exactly what a job
    // that never starts looks like.
    if (!data) return { ok: false, detail: `no run of "${job}" has ever been recorded` }

    const age = now - new Date(data.last_run_at).getTime()
    if (age > STALE_AFTER_MS) {
      const minutes = Math.round(age / 60000)
      return { ok: false, detail: `"${job}" has not run for ${minutes} minutes — the scheduler may be disabled` }
    }
    return { ok: true, detail: `"${job}" ran ${Math.round(age / 60000)} minutes ago` }
  } catch (e) {
    return { ok: false, detail: `could not read the heartbeat: ${e.message}` }
  }
}

module.exports = { recordRun, checkHeartbeat, REMINDER_JOB, STALE_AFTER_MS }
