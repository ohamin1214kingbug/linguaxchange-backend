// Pure. No database, no network — so the rules are testable in milliseconds
// and the route stays a thin shell around them, matching utils/classRequests.js.

const LANGUAGES = ['KO', 'ES', 'DE', 'EN', 'PT', 'FR', 'IT']
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

// One banana buys a 60-minute class. If it also bought annotation of a
// 2,000-word essay nobody would ever choose to teach, so the unit is small:
// roughly ten minutes of a reviewer's time. Students split longer texts.
const MAX_WORDS = 300
const MAX_PROMPT = 200

// Long enough that an asynchronous reviewer in another timezone can get to
// it, short enough that a student is not left waiting a week for a refund.
const REQUEST_TTL_HOURS = 72

// Whitespace-separated tokens. Known wrong for Korean, where spacing is not
// word-delimiting the way it is in Spanish, so a 300-"word" Korean passage is
// materially longer and its reviewer is underpaid for the same banana. Left
// as-is for v1; revisit with a character limit for CJK if Korean requests
// become common. The frontend counter must use this same rule or the live
// count will disagree with the error message.
function countWords(text) {
  if (typeof text !== 'string') return 0
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

function expiresAt(from = new Date()) {
  return new Date(from.getTime() + REQUEST_TTL_HOURS * 60 * 60 * 1000)
}

function validateAssignmentRequest(body = {}) {
  const language_code = String(body.language_code || '').toUpperCase()
  if (!LANGUAGES.includes(language_code)) return { ok: false, error: 'Pick a language' }

  const level = body.level ? String(body.level).toUpperCase() : null
  if (level && !LEVELS.includes(level)) return { ok: false, error: 'Pick a valid level' }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) return { ok: false, error: 'Say what you were trying to write' }
  if (prompt.length > MAX_PROMPT) {
    return { ok: false, error: `Keep that to ${MAX_PROMPT} characters or fewer` }
  }

  // Deliberately NOT trimmed or normalised. Annotation offsets index into the
  // stored string, so it must round-trip byte-identical.
  const text = typeof body.body === 'string' ? body.body : ''
  const words = countWords(text)
  if (words === 0) return { ok: false, error: 'Paste the text you want feedback on' }
  if (words > MAX_WORDS) {
    return { ok: false, error: `Keep it to ${MAX_WORDS} words or fewer — split a longer text into separate requests` }
  }

  return { ok: true, language_code, level, prompt, body: text }
}

module.exports = {
  countWords, validateAssignmentRequest, expiresAt,
  LANGUAGES, LEVELS, MAX_WORDS, MAX_PROMPT, REQUEST_TTL_HOURS,
}
