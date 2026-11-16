// Numbers for the admin Growth tab. Pure, so it is tested without a
// database: how far members got (signed up, profile done, booked, attended,
// taught), per week of sign-up, and supply vs demand per language.

const WEEKS_SHOWN = 8

// A profile is done when the member can be matched: a photo, a language
// they teach and at least one they learn.
function isProfileDone(u) {
  return Boolean(u.photo_url && u.teach_language && (u.learn_languages || []).length)
}

// Monday of the UTC week, as YYYY-MM-DD.
function weekOf(iso) {
  const d = new Date(iso)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

// users: [{ id, created_at, photo_url, teach_language, learn_languages }]
// enrollments: [{ user_id, status, attended }]
// classes: [{ teacher_id, status }]
// upcoming: [{ language_code }] one per upcoming session
function buildGrowth({ users = [], enrollments = [], classes = [], upcoming = [], now = new Date() }) {
  const booked = new Set(enrollments.filter(e => e.status !== 'cancelled').map(e => e.user_id))
  const attended = new Set(enrollments.filter(e => e.attended || e.status === 'attended').map(e => e.user_id))
  const taught = new Set(classes.filter(c => c.status === 'approved' || c.status === 'completed').map(c => c.teacher_id))
  const steps = list => ({
    signedUp: list.length,
    profileDone: list.filter(isProfileDone).length,
    booked: list.filter(u => booked.has(u.id)).length,
    attended: list.filter(u => attended.has(u.id)).length,
    taught: list.filter(u => taught.has(u.id)).length,
  })

  const recent = new Set()
  for (let i = 0; i < WEEKS_SHOWN; i++) recent.add(weekOf(new Date(now.getTime() - i * 7 * 864e5).toISOString()))
  const byWeek = new Map([...recent].map(w => [w, []]))
  const earlier = []
  for (const u of users) (byWeek.get(weekOf(u.created_at)) || earlier).push(u)
  const weeks = [...byWeek].map(([week, list]) => ({ week, ...steps(list) }))
  if (earlier.length) weeks.push({ week: 'earlier', ...steps(earlier) })

  const codes = new Set([...upcoming.map(s => s.language_code), ...users.flatMap(u => u.learn_languages || [])])
  const languages = [...codes].filter(Boolean).map(code => ({
    code,
    learners: users.filter(u => (u.learn_languages || []).includes(code)).length,
    teachers: users.filter(u => u.teach_language === code).length,
    upcoming: upcoming.filter(s => s.language_code === code).length,
  })).sort((a, b) => (b.learners - b.upcoming) - (a.learners - a.upcoming))

  return { totals: steps(users), weeks, languages }
}

module.exports = { buildGrowth, isProfileDone, weekOf }
