// One-off: tell existing members that LinguaXchange is now GongbuLeng.
//
//   node scripts/announceRename.js                  # dry run: count + full text, sends nothing
//   node scripts/announceRename.js --test me@x.com  # one copy to that address only
//   node scripts/announceRename.js --send           # everyone who has not had it yet
//
// Why it exists: the move to gongbuleng.com signed every member out once
// (logins are stored per domain), and a login page under a name they have
// never seen looks exactly like phishing. So the email says what changed and
// carries no "sign in here" link — the address is given in plain text.
//
// Safe to re-run. Each successful send appends the user id to
// .announce-rename-sent.json next to this file (git-ignored), and every run
// skips those ids, so a run cut short by a crash, Ctrl+C or Resend's daily
// cap never mails anyone twice. Run it from a machine whose .env holds the
// backend's service key and RESEND_API_KEY.

const fs = require('fs')
const path = require('path')

const SENT_LOG = path.join(__dirname, '.announce-rename-sent.json')
const SEND_GAP_MS = 600 // Resend's default limit is 2 requests per second.

function isRecipient(user, now = new Date()) {
  if (!user.is_approved || user.deleted_at || !user.email) return false
  if (user.email.endsWith('.invalid')) return false
  return !user.suspended_until || new Date(user.suspended_until) <= now
}

function pendingRecipients(users, sentIds, now = new Date()) {
  const sent = new Set(sentIds)
  return users.filter(u => isRecipient(u, now) && !sent.has(u.id))
}

function renderEmail(firstName) {
  const hi = firstName ? `Hi ${firstName},` : 'Hi,'
  const hola = firstName ? `Hola ${firstName}:` : 'Hola:'
  const text = `${hi}

LinguaXchange has a new name: GongbuLeng. The site now lives at https://gongbuleng.com

- Old linguaxchange.com links still work and take you to the new address.
- You may need to sign in once more, with the same email and password or with Google as before.
- Our emails now come from notifications@gongbuleng.com.

Your account, credits, classes and history are exactly where you left them.

We will never ask for your password by email. Questions? Write to gongbuleng.team@gmail.com

— The GongbuLeng team

---

${hola}

LinguaXchange ahora se llama GongbuLeng. La web está en https://gongbuleng.com

- Los enlaces antiguos de linguaxchange.com siguen funcionando y te llevan a la nueva dirección.
- Puede que tengas que iniciar sesión otra vez, con el mismo correo y contraseña o con Google.
- Nuestros correos ahora llegan desde notifications@gongbuleng.com.

Tu cuenta, tus créditos, tus clases y tu historial siguen igual.

Nunca te pediremos tu contraseña por correo. ¿Dudas? Escríbenos a gongbuleng.team@gmail.com

— El equipo de GongbuLeng
`
  return { subject: 'LinguaXchange is now GongbuLeng', text }
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
  // ponytail: one page. PostgREST caps a response at 1000 rows; add .range()
  // paging if the member count ever gets near that.
  if (users.length >= 1000) throw new Error('1000+ rows came back; add paging before sending.')

  const sent = readSent()
  const pending = pendingRecipients(users, sent)
  console.log(`${pending.length} to email (${sent.length} already done). RESEND_API_KEY ${process.env.RESEND_API_KEY ? 'is' : 'is NOT'} set.`)

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
      // Three in a row means the quota or the key, not one bad address.
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

module.exports = { isRecipient, pendingRecipients, renderEmail }
