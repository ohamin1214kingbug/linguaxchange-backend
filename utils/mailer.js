const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
})

async function sendEmail({ to, subject, text }) {
  if (!to) return
  try {
    await transporter.sendMail({
      from: `LinguaXchange <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text
    })
  } catch (error) {
    console.error(`[EMAIL] Failed to send "${subject}" to ${to}:`, error.message)
  }
}

async function sendEmailDebug() {
  const gmailUser = process.env.GMAIL_USER || null
  const hasPassword = !!process.env.GMAIL_APP_PASSWORD
  const passwordLength = (process.env.GMAIL_APP_PASSWORD || '').length

  let verifyResult = null
  try {
    await transporter.verify()
    verifyResult = 'ok'
  } catch (e) {
    verifyResult = `verify failed: ${e.message}`
  }

  let sendResult = null
  if (verifyResult === 'ok') {
    try {
      await transporter.sendMail({
        from: `LinguaXchange <${gmailUser}>`,
        to: gmailUser,
        subject: 'LinguaXchange test email',
        text: 'If you got this, email sending works.'
      })
      sendResult = 'ok'
    } catch (e) {
      sendResult = `send failed: ${e.message}`
    }
  }

  return { gmailUser, hasPassword, passwordLength, verifyResult, sendResult }
}

module.exports = { sendEmail, sendEmailDebug }
