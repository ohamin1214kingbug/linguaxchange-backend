const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

// Monday (UTC midnight) that starts the ISO week containing `date`, as 'YYYY-MM-DD'.
// UTC is used consistently app-wide so streaks don't depend on server or user timezone.
function getWeekStart(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const isoDay = d.getUTCDay() || 7 // Sunday (0) -> 7, so Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - (isoDay - 1))
  return d.toISOString().slice(0, 10)
}

// Pure streak transition (no DB access, so it's unit-testable in isolation).
// `row` = { current_streak, longest_streak, last_active_week } as currently stored
// on the users table (last_active_week is null for a user with no activity yet).
// `eventDate` is when the qualifying "taught or attended a class" activity happened.
function computeStreakUpdate(row, eventDate) {
  const { current_streak, longest_streak, last_active_week } = row
  const thisWeek = getWeekStart(eventDate)

  if (last_active_week === thisWeek) {
    return { current_streak, longest_streak, last_active_week } // already counted this week
  }

  const isConsecutiveWeek = last_active_week != null &&
    new Date(last_active_week + 'T00:00:00Z').getTime() + WEEK_MS === new Date(thisWeek + 'T00:00:00Z').getTime()

  const newCurrent = isConsecutiveWeek ? current_streak + 1 : 1
  const newLongest = Math.max(longest_streak, newCurrent)

  return { current_streak: newCurrent, longest_streak: newLongest, last_active_week: thisWeek }
}

// Loads a user's streak fields, applies computeStreakUpdate, and writes the result
// back. Shared by the "student confirms attendance" and "admin marks class complete"
// routes — the same weekly-activity streak counts a class whether the user taught it
// or attended it. Never throws: a streak write failing shouldn't break the request
// that triggered it.
async function recordWeeklyActivity(userId, eventDate = new Date()) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('current_streak, longest_streak, last_active_week')
      .eq('id', userId)
      .single()

    if (error || !user) {
      console.error('[STREAK] Could not load streak fields for user', userId, error?.message)
      return
    }

    const updated = computeStreakUpdate(user, eventDate)
    if (updated.last_active_week === user.last_active_week) return // no-op, skip the write

    const { error: updateError } = await supabase
      .from('users')
      .update(updated)
      .eq('id', userId)

    if (updateError) {
      console.error('[STREAK] Could not update streak for user', userId, updateError.message)
    }
  } catch (e) {
    console.error('[STREAK] Unexpected error updating streak for user', userId, e.message)
  }
}

module.exports = { getWeekStart, computeStreakUpdate, recordWeeklyActivity }
