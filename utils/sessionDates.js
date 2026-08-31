const MAX_RECURRING_SESSIONS = 52
const RECURRENCE_STEP_DAYS = { weekly: 7, biweekly: 14 }

// Recurrence is stepped in the teacher's timezone, not the server's.
//
// A Date's setDate/setMonth advance the wall clock of whatever timezone the
// Node process happens to run in — UTC on the server. That kept the UTC time
// fixed across a daylight-saving change, which moves the class by an hour for
// everyone attending it: a 19:00 class in Madrid became 20:00 the week the
// clocks went forward. What has to stay fixed is the local hour people turn up
// at, so the UTC time is what moves instead.

function partsIn(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)

  const p = {}
  for (const { type, value } of parts) p[type] = value
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    // Some ICU versions render midnight as hour 24 under hour12: false.
    hour: +p.hour % 24,
    minute: +p.minute,
    second: +p.second,
  }
}

// How far ahead of UTC `timeZone` is at this instant, in milliseconds.
function offsetAt(date, timeZone) {
  const p = partsIn(date, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()
}

// The instant whose wall clock in `timeZone` reads as these parts.
//
// Two passes: the first offset is read at the wrong instant whenever the
// arithmetic lands on the far side of a transition, and correcting by it moves
// us close enough that the second read is right. Date.UTC normalises overflow,
// so month 13 rolls into January and day 38 into the next month for free.
function instantFrom(p, timeZone) {
  const naive = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  const firstGuess = naive - offsetAt(new Date(naive), timeZone)
  return new Date(naive - offsetAt(new Date(firstGuess), timeZone))
}

// The column is user-editable, so it cannot be trusted to hold a real IANA
// name. An unusable one falls back to UTC — the behaviour before any of this
// existed — rather than throwing on a class the teacher is trying to create.
function usableZone(timeZone) {
  if (!timeZone) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch (e) {
    return 'UTC'
  }
}

function step(date, recurrenceType, timeZone) {
  const p = partsIn(date, timeZone)
  if (recurrenceType === 'monthly') p.month += 1
  else p.day += RECURRENCE_STEP_DAYS[recurrenceType] || 7
  return instantFrom(p, timeZone)
}

function buildSessionDates(startDate, recurrenceType, endDate, timeZone) {
  const dates = [new Date(startDate)]
  if (!recurrenceType || !endDate) return dates

  const zone = usableZone(timeZone)
  const end = new Date(endDate)
  let next = new Date(startDate)

  while (dates.length < MAX_RECURRING_SESSIONS) {
    next = step(next, recurrenceType, zone)
    if (next > end) break
    dates.push(new Date(next))
  }
  return dates
}

module.exports = { buildSessionDates, MAX_RECURRING_SESSIONS }
