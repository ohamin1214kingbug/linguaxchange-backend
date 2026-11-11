const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('./mailer')
const { renderEmail } = require('./emailTemplate')
const { FRONTEND_URL } = require('./frontendUrl')
const { pushNotifications } = require('./push')
const { notifyClassAlerts } = require('./classAlerts')
const { hasUpcomingSession } = require('./classSearch')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const UNIVERSITY_REASON = 'Verified university email'

// The one place a member becomes approved to teach. Two callers: an admin's
// click (routes/admin.js) and a confirmed university email
// (routes/university.js, `auto: true`).
//
// Approving the member also publishes the classes they created while
// waiting. Those used to need a second approval each, on the same person,
// and one whose date passed in the meantime could not be approved at all.
//
// Only a not-approved → approved change returns a row, so a second click (or
// two admins at once) emails nobody twice. is_approved can be null for email
// sign-ups, hence the or(). The automatic path also requires approval_reason
// to be empty: an admin's "Rejected by admin" must outlive a university email.
//
// Returns { user, published } — user is null when nothing changed. Throws
// only if the approval itself fails; everything after it is best effort.
async function approveMember(userId, { auto = false } = {}) {
  let query = supabase
    .from('users')
    .update(auto ? { is_approved: true, approval_reason: UNIVERSITY_REASON } : { is_approved: true })
    .eq('id', userId)
    .or('is_approved.is.null,is_approved.eq.false')
  if (auto) query = query.is('approval_reason', null)
  const { data: approved, error } = await query.select('id, email, first_name')
  if (error) throw error

  const user = approved?.[0]
  if (!user) return { user: null, published: [] }

  const published = await publishPendingClasses(user.id)
  // "Live" is only true of a class students can still join; one whose date
  // has passed is published too, but stays off the browse page until the
  // teacher gives it a new date.
  const live = published.filter(cls => hasUpcomingSession(cls))

  await sendEmail({
    to: user.email,
    subject: 'Your GongbuLeng account is approved',
    ...renderEmail({
      heading: "You're approved to teach",
      paragraphs: [
        `Good news, ${user.first_name || 'there'}: your account is approved, so you can now create and teach your own classes.`,
        live.length ? `${live.map(cls => `'${cls.title}'`).join(', ')} ${live.length === 1 ? 'is' : 'are'} now live, and students can join.` : '',
        'You earn 1 banana for every student who attends.',
      ],
      button: { label: 'Create a class', url: `${FRONTEND_URL}/classes/create` },
    }),
  })

  // The approval itself has happened; a failed notification only costs the
  // in-app copy of the email, so it is logged rather than surfaced.
  const rows = [{
    user_id: user.id,
    type: 'account_approved',
    message: 'Your account is approved. You can now create and teach classes.'
  }]
  const { error: notifyError } = await supabase.from('notifications').insert(rows)
  if (notifyError) console.error('[APPROVE_NOTIFY]', notifyError.message)
  else pushNotifications(rows)

  live.forEach(cls => notifyClassAlerts(cls))
  return { user, published }
}

// Never throws: the member is approved either way, and a class left pending
// is logged for the admin page to show.
async function publishPendingClasses(teacherId) {
  const { data: pending, error } = await supabase
    .from('classes')
    .select('id, title, teacher_id, language_code, level, class_sessions(session_date, status)')
    .eq('teacher_id', teacherId)
    .eq('status', 'pending')
  if (error) {
    console.error('[APPROVE_CLASSES] Could not read pending classes', error.message)
    return []
  }
  if (!pending?.length) return []

  const { error: updateError } = await supabase
    .from('classes')
    .update({ status: 'approved' })
    .in('id', pending.map(cls => cls.id))
  if (updateError) {
    console.error('[APPROVE_CLASSES] Could not publish pending classes', updateError.message)
    return []
  }
  return pending
}

module.exports = { approveMember, UNIVERSITY_REASON }
