const { sendEmail } = require('./mailer')
const { renderEmail } = require('./emailTemplate')
const { FRONTEND_URL } = require('./frontendUrl')
const { createClient } = require('@supabase/supabase-js')

// Created on first use, like utils/referrals.js: modules that only send the
// first-class email (and their tests) never need a database client.
let client
const db = () => (client ||= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY))

// Same source of truth requireAdmin/isAdmin use in middleware/auth.js —
// keeping admin identity in one env var means adding/removing an admin
// doesn't require touching multiple files.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean)

// A new teacher's first class went live (owner decision, 2026-11-19: no
// approval step). The admin looks at it and can hide it from /admin
// (classes are rejected there, which takes them off Explore). Best effort.
async function notifyAdminsOfFirstClass(teacher, cls) {
  const name = [teacher?.first_name, teacher?.last_name].filter(Boolean).join(' ') || 'A member'
  for (const adminEmail of ADMIN_EMAILS) {
    try {
      await sendEmail({
        to: adminEmail,
        subject: `New teacher: ${name} posted their first class`,
        ...renderEmail({
          heading: "A new teacher's first class is live",
          paragraphs: [
            `${name} (${teacher?.email || 'no email'}) just posted their first class, and it is already public.`,
            'Have a quick look. If it is not OK, hide it from the admin page.',
          ],
          box: [['Class:', cls.title], ['Language:', `${cls.language_code} · ${cls.level}`]],
          button: { label: 'See the class', url: `${FRONTEND_URL}/classes/${cls.id}` },
          footnote: `Hide it: ${FRONTEND_URL}/admin (Classes)`,
        }),
      })
    } catch (e) {
      console.error('[ADMIN_NOTIFY] Failed to notify', adminEmail, e.message)
    }
  }
}

// A new member finished signing up (owner request, 2026-11-19): sent when
// the phone is verified, so a Google signup that stops at the phone step
// doesn't count. Not an approval request; there is no approval step.
async function notifyAdminsOfNewMember(user, { method, referred_by } = {}) {
  const [{ count }, { data: inviter }] = await Promise.all([
    db().from('users').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    referred_by ? db().from('users').select('first_name').eq('id', referred_by).maybeSingle() : Promise.resolve({ data: null }),
  ]).catch(() => [{}, {}])
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'A new member'
  const box = [['Email:', user.email], ['Signed up with:', method === 'google' ? 'Google' : 'email']]
  if (inviter) box.push(['Invited by:', inviter.first_name || `member ${referred_by}`])
  if (count) box.push(['Members now:', String(count)])
  for (const adminEmail of ADMIN_EMAILS) {
    try {
      await sendEmail({
        to: adminEmail,
        subject: `New member: ${name}`,
        ...renderEmail({
          heading: 'A new member joined 🎉',
          paragraphs: [`${name} just finished signing up (phone verified).`],
          box,
          button: { label: 'See members', url: `${FRONTEND_URL}/admin` },
        }),
      })
    } catch (e) {
      console.error('[ADMIN_NOTIFY] Failed to notify', adminEmail, e.message)
    }
  }
}

module.exports = { notifyAdminsOfFirstClass, notifyAdminsOfNewMember }
