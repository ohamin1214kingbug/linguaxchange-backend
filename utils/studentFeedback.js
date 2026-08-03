// The seven skills a teacher scores. Column names, so the route can build a
// row without restating them and the frontend can render from one list.
const SKILLS = ['vocabulary', 'pronunciation', 'phrase_formation', 'fluency', 'grammar', 'listening', 'confidence']

const MAX_COMMENT = 300

// Pure. Accepts a partial body: an unrated skill is null, not 0, so the
// teacher can score only what they actually observed. Rejects the all-empty
// submission, which would just be noise in the student's history.
function validateFeedback(body = {}) {
  const skills = {}
  for (const skill of SKILLS) {
    const raw = body[skill]
    if (raw === undefined || raw === null || raw === '') {
      skills[skill] = null
      continue
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return { ok: false, error: `${skill} must be an integer between 1 and 5` }
    }
    skills[skill] = n
  }

  if (SKILLS.every(s => skills[s] === null)) {
    return { ok: false, error: 'Rate at least one skill' }
  }

  const comment = typeof body.comment === 'string' ? body.comment.trim() : ''
  if (comment.length > MAX_COMMENT) {
    return { ok: false, error: `Comment must be ${MAX_COMMENT} characters or fewer` }
  }

  return { ok: true, skills, comment: comment || null }
}

module.exports = { SKILLS, MAX_COMMENT, validateFeedback }
