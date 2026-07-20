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

module.exports = { sendEmail }
