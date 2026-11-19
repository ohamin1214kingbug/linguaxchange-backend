const { sendEmail } = require('./mailer')
const { renderEmail } = require('./emailTemplate')
const { FRONTEND_URL } = require('./frontendUrl')

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

module.exports = { notifyAdminsOfFirstClass }
