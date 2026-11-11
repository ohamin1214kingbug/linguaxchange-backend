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

// Fire-and-forget: a failed notification shouldn't fail the signup it's
// about, and admins can always find pending users in /admin regardless.
async function notifyAdminsOfPendingUser(user) {
  for (const adminEmail of ADMIN_EMAILS) {
    try {
      await sendEmail({
        to: adminEmail,
        subject: 'New user waiting for approval',
        ...renderEmail({
          heading: 'New member waiting for approval',
          paragraphs: [`${user.first_name || 'A new user'} (${user.email}) just signed up and is waiting for approval.`],
          button: { label: 'Review in admin', url: `${FRONTEND_URL}/admin` },
        }),
      })
    } catch (e) {
      console.error('[ADMIN_NOTIFY] Failed to notify', adminEmail, e.message)
    }
  }
}

module.exports = { notifyAdminsOfPendingUser }
