const MAX_RECURRING_SESSIONS = 52
const RECURRENCE_STEP_DAYS = { weekly: 7, biweekly: 14 }

function buildSessionDates(startDate, recurrenceType, endDate) {
  const dates = [new Date(startDate)]
  if (!recurrenceType || !endDate) return dates

  const end = new Date(endDate)
  let next = new Date(startDate)

  while (dates.length < MAX_RECURRING_SESSIONS) {
    next = new Date(next)
    if (recurrenceType === 'monthly') {
      next.setMonth(next.getMonth() + 1)
    } else {
      next.setDate(next.getDate() + (RECURRENCE_STEP_DAYS[recurrenceType] || 7))
    }
    if (next > end) break
    dates.push(new Date(next))
  }
  return dates
}

module.exports = { buildSessionDates, MAX_RECURRING_SESSIONS }
