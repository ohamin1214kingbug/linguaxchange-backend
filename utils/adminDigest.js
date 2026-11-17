// The daily "needs attention" summary for admins: shown at the top of the
// admin page (GET /api/admin/attention) and emailed once a day, only when
// there is something to look at (runAdminDigest, from routes/cron.js).
const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('./mailer')
const { renderEmail } = require('./emailTemplate')
const { FRONTEND_URL } = require('./frontendUrl')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const STALE_REPORT_MS = 48 * HOUR
const SPIKE_FACTOR = 3
const SPIKE_MIN = 5 // a jump from 1 to 4 sign-ups is not a spike
const SEND_FROM_HOUR = 9 // Madrid time
const DIGEST_JOB = 'admin-digest'

// Pure. reports: [{ id, report_type, reported_id, status, category, created_at }]
// signups: [{ created_at, phone_verified }] for the last 15 days
// noShows: [{ user_id, role, created_at, undone_at }] for the last day
function buildDigest({ reports = [], signups = [], noShows = [], now = new Date() }) {
  const t = now.getTime()
  const alerts = []

  for (const r of reports) {
    if (r.status === 'pending' && t - new Date(r.created_at).getTime() > STALE_REPORT_MS) {
      const days = Math.floor((t - new Date(r.created_at).getTime()) / DAY)
      alerts.push({ kind: 'stale_report', level: 'red', title: 'Report waiting more than 48 hours',
        text: `Report #${r.id}${r.report_type === 'user' ? ` against member #${r.reported_id}` : ` about class #${r.reported_id}`}${r.category ? ` (${r.category})` : ''}, open for ${days} days` })
    }
  }

  const recentByMember = {}
  for (const r of reports) {
    if (r.report_type === 'user' && t - new Date(r.created_at).getTime() <= 30 * DAY) {
      recentByMember[r.reported_id] = (recentByMember[r.reported_id] || 0) + 1
    }
  }
  for (const [id, n] of Object.entries(recentByMember)) {
    if (n >= 2) alerts.push({ kind: 'repeat_reports', level: 'amber', title: `Member with ${n} reports in 30 days`, text: `Member #${id}` })
  }

  const lastDay = signups.filter(s => t - new Date(s.created_at).getTime() <= DAY)
  const before = signups.filter(s => { const age = t - new Date(s.created_at).getTime(); return age > DAY && age <= 15 * DAY })
  const usual = before.length / 14
  if (lastDay.length >= SPIKE_MIN && lastDay.length > SPIKE_FACTOR * usual) {
    alerts.push({ kind: 'signup_spike', level: 'amber', title: 'Sign-up spike',
      text: `${lastDay.length} new members in the last 24 hours (usually about ${usual.toFixed(1)} a day). Check for fake accounts.` })
  }

  const teacherStrikes = noShows.filter(n => n.role === 'teacher' && !n.undone_at && t - new Date(n.created_at).getTime() <= DAY)
  for (const n of teacherStrikes) {
    alerts.push({ kind: 'teacher_no_show', level: 'amber', title: 'Teacher no-show recorded', text: `Member #${n.user_id} missed a class they were teaching` })
  }

  return {
    alerts,
    stats: {
      newMembers: lastDay.length,
      newVerified: lastDay.filter(s => s.phone_verified).length,
      noShows: noShows.filter(n => t - new Date(n.created_at).getTime() <= DAY).length,
      openReports: reports.filter(r => r.status === 'pending').length,
    },
  }
}

async function loadDigest(now = new Date()) {
  const since15 = new Date(now.getTime() - 15 * DAY).toISOString()
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString()
  const sinceDay = new Date(now.getTime() - DAY).toISOString()
  const [reports, signups, noShows] = await Promise.all([
    supabase.from('reports').select('id, report_type, reported_id, status, category, created_at')
      .or(`status.eq.pending,created_at.gte.${since30}`),
    supabase.from('users').select('created_at, phone_verified').gte('created_at', since15).is('deleted_at', null),
    supabase.from('no_show_events').select('user_id, role, created_at, undone_at').gte('created_at', sinceDay),
  ])
  const failed = [reports, signups, noShows].find(r => r.error)
  if (failed) throw failed.error
  return buildDigest({ reports: reports.data, signups: signups.data, noShows: noShows.data, now })
}

const madridDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
const madridHour = d => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: 'numeric', hourCycle: 'h23' }).format(d))

// Once per Madrid day, from 09:00, and an email only when there are alerts.
async function runAdminDigest(now = new Date()) {
  if (madridHour(now) < SEND_FROM_HOUR) return { sent: false, reason: 'too early' }
  const { data: last } = await supabase.from('cron_heartbeat').select('last_run_at').eq('job', DIGEST_JOB).maybeSingle()
  if (last?.last_run_at && madridDay(new Date(last.last_run_at)) === madridDay(now)) return { sent: false, reason: 'already ran today' }
  await supabase.from('cron_heartbeat').upsert({ job: DIGEST_JOB, last_run_at: now.toISOString() }, { onConflict: 'job' })

  const digest = await loadDigest(now)
  if (!digest.alerts.length) return { sent: false, reason: 'nothing to report' }
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)
  const mail = digestEmail(digest)
  for (const to of admins) await sendEmail({ to, ...mail })
  return { sent: true, alerts: digest.alerts.length }
}

// Pure.
function digestEmail({ alerts, stats }) {
  const n = alerts.length
  return {
    subject: `GongbuLeng: ${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} a look today`,
    ...renderEmail({
      heading: `${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} a look today`,
      paragraphs: alerts.map(a => `${a.level === 'red' ? '🚩' : '⚠️'} ${a.title}: ${a.text}`),
      box: [
        ['New members (24h):', `${stats.newMembers} (${stats.newVerified} verified their phone)`],
        ['No-shows (24h):', String(stats.noShows)],
        ['Open reports:', String(stats.openReports)],
      ],
      button: { label: 'Open the admin page', url: `${FRONTEND_URL}/admin` },
      footnote: 'Sent to admins once a day, only when something needs a look.',
    }),
  }
}

module.exports = { buildDigest, loadDigest, runAdminDigest, digestEmail, madridDay, madridHour }
