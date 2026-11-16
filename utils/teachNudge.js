// "People want to learn your language": the dashboard card and the email
// that ask members who can teach to post a class.
const { createClient } = require('@supabase/supabase-js')
const { renderEmail } = require('./emailTemplate')
const { FRONTEND_URL } = require('./frontendUrl')
const { LANGUAGE_NAMES } = require('./classAlerts')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const NUDGE_EVERY_MS = 14 * 24 * 60 * 60 * 1000

// Other members learning `code`, upcoming classes in it, and how many of
// those this member teaches. Cancelled and rejected classes don't count.
async function teachDemand(code, userId) {
  const now = new Date().toISOString()
  const [{ count, error: learnError }, { data: sessions, error: sessionError }] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true })
      .contains('learn_languages', [code]).neq('id', userId).is('deleted_at', null),
    supabase.from('class_sessions').select('id, classes!inner(teacher_id, language_code, status)')
      .eq('classes.language_code', code).not('classes.status', 'in', '(cancelled,rejected)')
      .neq('status', 'cancelled').gt('session_date', now),
  ])
  if (learnError || sessionError) throw learnError || sessionError
  const list = sessions || []
  return {
    learners: count || 0,
    upcoming: list.length,
    own_upcoming: list.filter(s => s.classes.teacher_id === userId).length,
  }
}

// Pure. Email only someone who teaches nothing coming up, in a language with
// learners waiting and no class at all, who hasn't turned these off and
// wasn't emailed in the last 14 days. (The dashboard card also shows when a
// few classes exist; an email for that would be noise.)
function shouldNudge({ prefs, sentAt, ownUpcoming, learners, upcoming = 0, now = new Date() }) {
  if (prefs?.teach_nudge === false) return false
  if (ownUpcoming > 0 || learners < 1 || upcoming > 0) return false
  return !sentAt || now - new Date(sentAt) >= NUDGE_EVERY_MS
}

// Pure. The email itself.
function teachNudgeEmail({ firstName, code, learners, upcoming }) {
  const language = LANGUAGE_NAMES[code] || code
  const people = learners === 1 ? '1 member wants' : `${learners} members want`
  return {
    subject: `${people} to learn ${language} on GongbuLeng`,
    ...renderEmail({
      heading: `${people} to learn ${language}`,
      paragraphs: [
        `Hi ${firstName || 'there'}, you teach ${language} on GongbuLeng, and right now ${upcoming ? `there ${upcoming === 1 ? 'is only 1' : `are only ${upcoming}`} ${language} class${upcoming === 1 ? '' : 'es'} coming up` : `there's no ${language} class for them to join`}.`,
        'A class takes 2 minutes to post, and any level or topic works.',
      ],
      box: [
        [`Learning ${language}:`, `${learners} member${learners === 1 ? '' : 's'}`],
        [`${language} classes coming up:`, upcoming ? String(upcoming) : 'none'],
        ['You earn:', '1 banana per student'],
      ],
      button: { label: `Post a ${language} class`, url: `${FRONTEND_URL}/classes/create?language_code=${encodeURIComponent(code)}` },
      footnote: `You get this because ${language} is your teaching language, at most once every 14 days. Turn it off in Settings.`,
    }),
  }
}

module.exports = { teachDemand, shouldNudge, teachNudgeEmail, NUDGE_EVERY_MS }
