// One-off: tell members approved before 2026-11-07 that they are approved.
// Until then approving someone sent nothing, although the Google sign-up
// welcome email promised "we'll email you when it is". New approvals email
// automatically (routes/admin.js), so this only covers the earlier ones.
//
//   node scripts/announceApproved.js                  # dry run: count + full text, sends nothing
//   node scripts/announceApproved.js --test me@x.com  # one copy to that address only
//   node scripts/announceApproved.js --send           # everyone who has not had it yet
//
// Same safety as announceRename.js: sent ids go to .announce-approved-sent.json
// (git-ignored), so re-runs never mail anyone twice. Admins (ADMIN_EMAILS)
// are skipped. Run it from a machine whose .env holds the backend's service
// key and the current RESEND_API_KEY.

const fs = require('fs')
const path = require('path')
const { pendingRecipients } = require('./announceRename')

const SENT_LOG = path.join(__dirname, '.announce-approved-sent.json')
const SEND_GAP_MS = 600 // Resend's default limit is 2 requests per second.

function renderEmail(firstName) {
  const hi = firstName ? `Hi ${firstName},` : 'Hi,'
  const hola = firstName ? `Hola ${firstName}:` : 'Hola:'
  const text = `${hi}

Good news: your GongbuLeng account is approved. You can now create and teach your own classes.

- Create a class at gongbuleng.com/classes/create
- You earn 1 banana for every student who attends.
- Teaching once also unlocks your last banana for joining classes.

Questions? Write to gongbuleng.team@gmail.com

— The GongbuLeng team

---

${hola}

Buenas noticias: tu cuenta de GongbuLeng está aprobada. Ya puedes crear y dar tus propias clases.

- Crea una clase en gongbuleng.com/classes/create
- Ganas 1 plátano por cada estudiante que asista.
- Dar una clase también desbloquea tu último plátano para unirte a clases.

¿Dudas? Escríbenos a gongbuleng.team@gmail.com

— El equipo de GongbuLeng
`
  return { subject: 'Your GongbuLeng account is approved', text }
}

const readSent = () => (fs.existsSync(SENT_LOG) ? JSON.parse(fs.readFileSync(SENT_LOG, 'utf8')) : [])
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main(args) {
  require('dotenv').config()
  const { sendEmail } = require('../utils/mailer')
  const mode = args[0]

  if (mode === '--test') {
    const to = args[1]
    if (!to) throw new Error('Usage: --test you@example.com')
    const result = await sendEmail({ to, ...renderEmail(null) })
    console.log(result.ok ? `Test copy sent to ${to}.` : `Test send failed: ${result.error}`)
    return
  }

  const { createClient } = require('@supabase/supabase-js')
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, first_name, is_approved, deleted_at, suspended_until')
    .eq('is_approved', true)
    .is('deleted_at', null)
  if (error) throw new Error(`Could not read users: ${error.message}`)
  if (users.length >= 1000) throw new Error('1000+ rows came back; add paging before sending.')

  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  const sent = readSent()
  const pending = pendingRecipients(users, sent).filter(u => !admins.includes(u.email.toLowerCase()))
  console.log(`${pending.length} to email (${sent.length} already done, admins skipped). RESEND_API_KEY ${process.env.RESEND_API_KEY ? 'is' : 'is NOT'} set.`)

  if (mode !== '--send') {
    const { subject, text } = renderEmail('Ana')
    console.log(`\nDry run: nothing sent. The email, as "Ana" would get it:\n\nSubject: ${subject}\n\n${text}`)
    return
  }

  console.log('Sending in 5 seconds. Ctrl+C to abort.')
  await sleep(5000)

  let failuresInARow = 0
  for (const [i, user] of pending.entries()) {
    const result = await sendEmail({ to: user.email, ...renderEmail(user.first_name) })
    if (result.ok) {
      sent.push(user.id)
      fs.writeFileSync(SENT_LOG, JSON.stringify(sent))
      failuresInARow = 0
      console.log(`${i + 1}/${pending.length} sent (user ${user.id})`)
    } else {
      failuresInARow++
      console.log(`${i + 1}/${pending.length} FAILED (user ${user.id}): ${result.error}`)
      if (failuresInARow >= 3) {
        console.log('Stopped after 3 failures in a row. Fix the cause and re-run; sent users are skipped.')
        break
      }
    }
    await sleep(SEND_GAP_MS)
  }
  console.log(`Done. ${sent.length} members have had the email in total.`)
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1) })
}

module.exports = { renderEmail }
