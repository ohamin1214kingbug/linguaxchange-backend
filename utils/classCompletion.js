const { createClient } = require('@supabase/supabase-js')
const { recordWeeklyActivity } = require('./streak')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const HOUR_MS = 60 * 60 * 1000
// Long enough after the scheduled end that a class running over is not
// closed while people are still in the room.
const GRACE_MS = HOUR_MS
// A class that ended longer ago than this still gets closed, but is too old
// to count toward this week's streak (the backlog on the first run).
const STREAK_WINDOW_MS = 48 * HOUR_MS

// Pure. When the class's last session ended, or null while it still has a
// session ahead of it (or never had one). Cancelled sessions do not count.
function finishedAt(cls, now = new Date()) {
  const sessions = (cls.class_sessions || []).filter(s => s.status !== 'cancelled')
  if (!sessions.length) return null
  const last = Math.max(...sessions.map(s => new Date(s.session_date).getTime()))
  const end = last + (cls.duration_minutes || 60) * 60 * 1000
  return end + GRACE_MS <= now.getTime() ? new Date(end) : null
}

// Pure. A class counts as taught once it is over and at least one student
// was still enrolled. One nobody joined is over too, but never "completed":
// that status is what the teaching badges count.
function shouldComplete(cls, now = new Date()) {
  if (cls.status !== 'approved' || !finishedAt(cls, now)) return false
  return (cls.class_sessions || []).some(s =>
    s.status !== 'cancelled' && (s.class_enrollments || []).some(e => e.status !== 'cancelled'))
}

// Runs on the reminders cron. Until 2026-11 an admin had to press "Mark
// complete" on every class, so badges and streaks lagged by however long
// that took. Never throws: a failed sweep must not cost the reminders that
// share its tick. Returns { completed }, null when the sweep itself failed.
// ponytail: reads every approved class each tick; filter by date in SQL when
// there are thousands.
async function completeFinishedClasses(now = new Date()) {
  try {
    const { data: classes, error } = await supabase
      .from('classes')
      .select('id, teacher_id, status, duration_minutes, class_sessions(session_date, status, class_enrollments(status))')
      .eq('status', 'approved')
    if (error) throw error

    let completed = 0
    for (const cls of (classes || []).filter(c => shouldComplete(c, now))) {
      // Guarded on status so two overlapping ticks cannot both count it.
      const { data: claimed, error: updateError } = await supabase
        .from('classes')
        .update({ status: 'completed' })
        .eq('id', cls.id)
        .eq('status', 'approved')
        .select('id')
      if (updateError || !claimed?.length) continue
      completed++
      if (now.getTime() - finishedAt(cls, now).getTime() <= STREAK_WINDOW_MS) {
        await recordWeeklyActivity(cls.teacher_id)
      }
    }
    return { completed }
  } catch (e) {
    console.error('[CLASS_COMPLETE] Sweep failed', e.message)
    return { completed: null }
  }
}

module.exports = { finishedAt, shouldComplete, completeFinishedClasses }
