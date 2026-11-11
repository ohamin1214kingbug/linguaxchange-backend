// The values a profile may hold, shared by the two routes that write them.
//
// Registration validated these and PATCH did not, so a level could be set
// correctly at signup and replaced with anything at all afterwards — which
// is how a translated label ended up stored as a level.
const LANGUAGES = ['KO', 'ES', 'DE', 'EN', 'PT', 'FR', 'IT']

// 'Native' is a value, not a label. Whatever the interface shows a Korean
// speaker, what gets stored is this string, or the comparison below fails
// and every reader has to guess.
const TEACH_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Native']

// Someone learning a language is not a native speaker of it.
const LEARN_LEVELS = TEACH_LEVELS.filter(level => level !== 'Native')
const LEARN_NOTE_MAX = 200

// learn_details is { [languageCode]: { level, note } }, written as a whole
// by the profile form. Returns { ok, value } with empty entries dropped and
// notes trimmed, or { ok: false, error }. Only languages in learnLanguages
// are kept: un-ticking a language drops its detail too, instead of leaving a
// level behind for a language the member no longer lists.
function cleanLearnDetails(details, learnLanguages) {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) {
    return { ok: false, error: 'Learning details must be an object' }
  }
  const listed = new Set(Array.isArray(learnLanguages) ? learnLanguages : [])
  const value = {}
  for (const [code, entry] of Object.entries(details)) {
    if (!LANGUAGES.includes(code)) return { ok: false, error: 'That is not a language we support' }
    if (!listed.has(code) || !entry || typeof entry !== 'object') continue
    const level = entry.level || null
    const note = typeof entry.note === 'string' ? entry.note.trim() : ''
    if (level !== null && !LEARN_LEVELS.includes(level)) return { ok: false, error: 'That is not a valid level' }
    if (note.length > LEARN_NOTE_MAX) return { ok: false, error: `Keep each description under ${LEARN_NOTE_MAX} characters` }
    if (level || note) value[code] = { level, note }
  }
  return { ok: true, value }
}

// The card colours a member can pick. Same list as the CHECK in
// migrations/add_profile_color.sql and lib/profileColors.js in the frontend.
const PROFILE_COLORS = ['yellow', 'blue', 'coral', 'green', 'purple', 'teal', 'white']

module.exports = { LANGUAGES, TEACH_LEVELS, LEARN_LEVELS, LEARN_NOTE_MAX, PROFILE_COLORS, cleanLearnDetails }
