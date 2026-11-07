const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('./mailer')
const { FRONTEND_URL } = require('./frontendUrl')
const { LANGUAGES, LEVELS } = require('./classRequests')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const LANGUAGE_NAMES = {
  KO: 'Korean', ES: 'Spanish', DE: 'German', EN: 'English',
  PT: 'Portuguese', FR: 'French', IT: 'Italian',
}

// Pure. Level '' is "any level"; anything else must be a real class level.
function validateAlert({ language_code, level }) {
  if (!LANGUAGES.includes(language_code)) return 'That is not a language we teach'
  if (level && !LEVELS.includes(level)) return 'That is not a valid level'
  return null
}

// Pure. The link opens the browse page already filtered to what they asked
// for, which is also where the alert is switched off.
function buildAlertEmail(cls, firstName) {
  const language = LANGUAGE_NAMES[cls.language_code] || cls.language_code
  const link = `${FRONTEND_URL}/classes?language=${cls.language_code}&level=${cls.level}`
  return {
    subject: `New ${language} ${cls.level} class: ${cls.title}`,
    text: [
      `Hi ${firstName || 'there'},`,
      '',
      `A new ${language} ${cls.level} class was just posted on GongbuLeng: "${cls.title}".`,
      '',
      `See it and join: ${link}`,
      '',
      `You get this because you asked to hear about new ${language} classes. Turn it off on the same page.`,
    ].join('\n'),
  }
}

// Called once a class is visible to students: at creation for an approved
// teacher, or when an admin approves it. Never throws — the class exists
// either way, and a failed alert is logged, not surfaced to the teacher.
// ponytail: one email per class per subscriber, sent one after another;
// switch to a daily digest if members start following busy languages.
async function notifyClassAlerts(cls) {
  try {
    const { data: alerts, error } = await supabase
      .from('class_alerts')
      .select('user_id, users(email, first_name, deleted_at)')
      .eq('language_code', cls.language_code)
      .in('level', ['', cls.level])
    if (error) {
      console.error('[CLASS_ALERT] Could not read alerts:', error.message)
      return 0
    }

    // A member can follow both "Korean" and "Korean A2"; mail them once.
    const seen = new Set()
    let sent = 0
    for (const alert of alerts || []) {
      const user = alert.users
      if (alert.user_id === cls.teacher_id || seen.has(alert.user_id)) continue
      if (!user?.email || user.deleted_at) continue
      seen.add(alert.user_id)
      const result = await sendEmail({ to: user.email, ...buildAlertEmail(cls, user.first_name) })
      if (result.ok) sent++
    }
    return sent
  } catch (e) {
    console.error('[CLASS_ALERT] Failed:', e.message)
    return 0
  }
}

module.exports = { LANGUAGE_NAMES, validateAlert, buildAlertEmail, notifyClassAlerts }
