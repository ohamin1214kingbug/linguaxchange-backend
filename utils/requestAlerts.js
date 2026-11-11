const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('./mailer')
const { renderEmail } = require('./emailTemplate')
const { FRONTEND_URL } = require('./frontendUrl')
const { LANGUAGE_NAMES } = require('./classAlerts')
const { formatSessionTime } = require('./classReminder')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Pure. Opted in unless they switched it off — same convention as
// low_credit_nudge, so existing members get it without a backfill.
function wantsRequestEmails(prefs) {
  return prefs?.request_emails !== false
}

// Pure. Time shown in the teacher's own zone, since they are the one
// deciding whether they can make it.
function buildRequestEmail(request, teacher) {
  const language = LANGUAGE_NAMES[request.language_code] || request.language_code
  const what = [language, request.level].filter(Boolean).join(' ')
  const when = formatSessionTime(request.preferred_time, teacher.timezone, teacher.time_format).display
  const link = `${FRONTEND_URL}/classes?tab=requests&language=${request.language_code}`
  return {
    subject: `A student wants a ${what} class: ${request.topic}`,
    ...renderEmail({
      heading: `A student wants a ${what} class`,
      paragraphs: [
        `Hi ${teacher.first_name || 'there'}, someone asked for a class you could teach.`,
        'Answer it and every student who joins earns you a banana.',
      ],
      box: [['Topic:', request.topic], ['Preferred time:', `${when}${request.time_flexible ? ' (flexible)' : ''}`]],
      button: { label: 'See the request', url: link },
      footnote: 'You get this because you teach this language. Turn these emails off in Settings.',
    }),
  }
}

// Called after a request is posted. Nobody heard about new requests before,
// so a request only got answered if a teacher happened to open the board in
// its 24 hours. Never throws: the request exists either way.
// ponytail: emails every teacher of the language; add weekly availability
// matching if there are ever enough teachers per language for this to feel
// like spam.
async function notifyTeachersOfRequest(request) {
  try {
    const { data: teachers, error } = await supabase
      .from('users')
      .select('id, email, first_name, timezone, time_format, notification_preferences')
      .eq('teach_language', request.language_code)
      .is('deleted_at', null)
      .neq('id', request.student_id)
    if (error) {
      console.error('[REQUEST_ALERT] Could not read teachers:', error.message)
      return 0
    }

    let sent = 0
    for (const teacher of teachers || []) {
      if (!teacher.email || !wantsRequestEmails(teacher.notification_preferences)) continue
      const result = await sendEmail({ to: teacher.email, ...buildRequestEmail(request, teacher) })
      if (result.ok) sent++
    }
    return sent
  } catch (e) {
    console.error('[REQUEST_ALERT] Failed:', e.message)
    return 0
  }
}

module.exports = { wantsRequestEmails, buildRequestEmail, notifyTeachersOfRequest }
