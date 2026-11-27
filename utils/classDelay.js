// A teacher running late moves a session's start by 5, 10 or 15 minutes
// (owner, 2026-11-27), up to 15 in total, so a few minutes late is not a
// no-show. Pure, so the rules are tested without a database.
//
// Allowed from 30 minutes before the original start until the current
// start's no-show cutoff (start + 15 min, utils/noShow.js): after that the
// session has already been judged.
const STEPS = [5, 10, 15]
const MAX_DELAY_MIN = 15
const MIN = 60 * 1000
const NO_SHOW_GRACE_MIN = 15
const EARLIEST_BEFORE_MIN = 30

function checkDelay({ sessionDate, delayedMinutes = 0, minutes, status, teacherCheckedAt, now = new Date() }) {
  if (!STEPS.includes(minutes)) return { ok: false, error: 'Choose 5, 10 or 15 minutes' }
  if (status !== 'scheduled' || teacherCheckedAt) return { ok: false, error: 'This class can no longer be moved' }
  if (delayedMinutes + minutes > MAX_DELAY_MIN) return { ok: false, error: `A class can start at most ${MAX_DELAY_MIN} minutes later` }
  const start = new Date(sessionDate).getTime()
  const original = start - delayedMinutes * MIN
  const t = now.getTime()
  if (t < original - EARLIEST_BEFORE_MIN * MIN) return { ok: false, error: 'You can move the start from 30 minutes before the class' }
  if (t > start + NO_SHOW_GRACE_MIN * MIN) return { ok: false, error: 'This class can no longer be moved' }
  return { ok: true, newDate: new Date(start + minutes * MIN), delayedMinutes: delayedMinutes + minutes }
}

module.exports = { checkDelay, STEPS, MAX_DELAY_MIN }
