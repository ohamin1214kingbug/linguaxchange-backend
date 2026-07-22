const { Resend } = require('resend')

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

async function sendEmail({ to, subject, text }) {
  if (!to) return
  if (!resend) {
    console.error(`[EMAIL] Skipped "${subject}" to ${to}: RESEND_API_KEY is not set`)
    return
  }
  try {
    const { error } = await resend.emails.send({
      from: 'LinguaXchange <notifications@linguaxchange.com>',
      to,
      subject,
      text
    })
    if (error) console.error(`[EMAIL] Failed to send "${subject}" to ${to}:`, error.message)
  } catch (error) {
    console.error(`[EMAIL] Failed to send "${subject}" to ${to}:`, error.message)
  }
}

module.exports = { sendEmail }
