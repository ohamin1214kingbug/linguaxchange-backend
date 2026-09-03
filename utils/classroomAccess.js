// Who may hold a Jitsi room, and when.
//
// Moderator rights are not the question — those come from a server-signed
// JaaS claim keyed on teacher_id, so join order cannot grant them. What was
// missing is a time window: an enrolled student could ask for a room token
// days early and sit in an empty room, which looks like running the class
// even without a moderator's powers.
//
// The gate lives on the token, not the button. The room is unreachable
// without a token, so hiding the dashboard link is presentation; this is
// enforcement.

const TEACHER_EARLY_MS = 10 * 60 * 1000

// Browser clocks drift. Without a grace, a student clicking at 18:00:00
// against a server reading 17:59:58 gets a 403 on a class that has started.
const STUDENT_SKEW_MS = 60 * 1000

// Classes run over. Closing the room on the scheduled minute would eject a
// class mid-sentence.
const OVERRUN_MS = 30 * 60 * 1000

const DEFAULT_DURATION_MINUTES = 60

function canJoinClassroom({ sessionDate, durationMinutes, isTeacher = false, now = new Date() }) {
  const start = new Date(sessionDate)
  if (!sessionDate || Number.isNaN(start.getTime())) {
    return { ok: false, error: 'This class has no scheduled time yet' }
  }

  const minutes = durationMinutes || DEFAULT_DURATION_MINUTES
  const opensAt = new Date(start.getTime() - (isTeacher ? TEACHER_EARLY_MS : STUDENT_SKEW_MS))
  const closesAt = new Date(start.getTime() + minutes * 60 * 1000 + OVERRUN_MS)

  if (now < opensAt) {
    return {
      ok: false,
      opensAt,
      error: isTeacher
        ? 'You can open the classroom 10 minutes before the class starts'
        : 'The classroom opens when the class starts'
    }
  }

  if (now > closesAt) {
    return { ok: false, opensAt, error: 'This class has already ended' }
  }

  return { ok: true, opensAt }
}

module.exports = { canJoinClassroom, TEACHER_EARLY_MS, STUDENT_SKEW_MS, OVERRUN_MS }
