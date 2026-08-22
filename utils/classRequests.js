// A posted request is a wanted-ad, not a booking: it stays up for a day and
// then it's gone. Short on purpose — a board full of month-old "anyone want
// to teach me subjunctive?" posts is a board nobody reads.
const REQUEST_TTL_HOURS = 24

// How many open requests one person can have at once. Without a cap, one
// enthusiastic student can bury the board for everyone else.
const MAX_OPEN_PER_USER = 3

const MAX_TOPIC = 80
const MAX_DETAILS = 400

// A request a teacher can't turn into a class is worse than no request: it
// posts fine, then collapses when someone answers it. Same bounds as the
// classes table, from one place — see utils/classSize.js.
const { MAX_CLASS_SIZE, isValidClassSize, CLASS_SIZE_ERROR } = require('./classSize')

const LANGUAGES = ['KO', 'ES', 'DE', 'EN', 'PT', 'FR', 'IT']
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

function expiresAt(from = new Date()) {
  return new Date(from.getTime() + REQUEST_TTL_HOURS * 60 * 60 * 1000)
}

// Whole hours remaining, floored, never negative — what the countdown badge
// shows. Under an hour reports 0, which the UI renders as "less than 1h".
function hoursLeft(expires, now = new Date()) {
  const ms = new Date(expires).getTime() - now.getTime()
  return ms <= 0 ? 0 : Math.floor(ms / (60 * 60 * 1000))
}

// Pure. Everything a teacher needs to decide whether to pick this up:
// which language, what exactly to cover, how big, and when.
function validateRequest(body = {}, now = new Date()) {
  if (!LANGUAGES.includes(body.language_code)) {
    return { ok: false, error: 'Pick a language' }
  }

  // Optional — a request can be level-agnostic ("anyone, just talk to me").
  const level = body.level || null
  if (level && !LEVELS.includes(level)) {
    return { ok: false, error: 'Pick a valid level' }
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
  if (!topic) return { ok: false, error: 'Say what you want to learn' }
  if (topic.length > MAX_TOPIC) {
    return { ok: false, error: `Keep the topic to ${MAX_TOPIC} characters or fewer` }
  }

  const details = typeof body.details === 'string' ? body.details.trim() : ''
  if (details.length > MAX_DETAILS) {
    return { ok: false, error: `Keep the details to ${MAX_DETAILS} characters or fewer` }
  }

  const maxStudents = Number(body.max_students)
  if (!isValidClassSize(maxStudents)) {
    return { ok: false, error: CLASS_SIZE_ERROR }
  }

  // Required even when flexible: "sometime, whenever" gives a teacher
  // nothing to work from. time_flexible says the time is negotiable, not
  // that there isn't one.
  const preferred = new Date(body.preferred_time)
  if (!body.preferred_time || isNaN(preferred.getTime())) {
    return { ok: false, error: 'Pick a time that would work for you' }
  }
  if (preferred.getTime() <= now.getTime()) {
    return { ok: false, error: 'That time has already passed. Please pick a future time.' }
  }

  return {
    ok: true,
    language_code: body.language_code,
    level,
    topic,
    details: details || null,
    max_students: maxStudents,
    preferred_time: preferred.toISOString(),
    time_flexible: !!body.time_flexible
  }
}

module.exports = {
  REQUEST_TTL_HOURS, MAX_OPEN_PER_USER, MAX_TOPIC, MAX_DETAILS, MAX_CLASS_SIZE,
  LANGUAGES, LEVELS, expiresAt, hoursLeft, validateRequest
}
