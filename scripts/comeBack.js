// One-off (2026-11-18): email members whose account isn't finished (no
// verified phone and/or no languages) once, with what's missing.
//
//   node scripts/comeBack.js                  # dry run: who gets which version, sends nothing
//   node scripts/comeBack.js --test me@x.com  # one copy of each version to that address only
//   node scripts/comeBack.js --send           # everyone not emailed yet, once there are 30 members
//
// The owner chose (2026-11-18) to send only once the site has 30 members
// (not deleted, owner's accounts included): --send does nothing below that.
// #7 and #9 are the owner's own accounts.
//
// Skips admins, suspended and deleted accounts, and complete profiles.
// Sent addresses go to .come-back-sent.json (git-ignored) so a rerun never
// emails anyone twice. Run one at a time: the log is read once at start.
require('dotenv').config({ quiet: true })
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('../utils/mailer')
const { renderEmail } = require('../utils/emailTemplate')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
const LOG = path.join(__dirname, '..', '.come-back-sent.json')
const URL = 'https://gongbuleng.com/dashboard'
const SEND_AT_MEMBERS = 30
const OWNER_IDS = new Set([7, 9])

const missingPhone = u => !u.phone_verified
const missingLanguages = u => !u.teach_language?.trim() || !(u.learn_languages || []).some(Boolean)

// Pure: the email for one member.
function comeBackEmail(firstName, { phone, langs }) {
  const name = firstName || 'there'
  const en = [], es = []
  if (phone) { en.push(['📱 Verify your phone:', 'your 3 free bananas arrive at once']); es.push('📱 Verifica tu teléfono: recibes al momento tus 3 plátanos gratis') }
  if (langs) { en.push(['🗣️ Pick your languages:', 'what you teach and what you learn']); es.push('🗣️ Elige tus idiomas: cuál enseñas y cuáles aprendes') }
  en.push(['🗳️ Answer 5 quick questions:', '+1 banana']); es.push('🗳️ Responde 5 preguntas rápidas: +1 plátano')
  // Members who verified their phone already have their bananas: for them
  // it's about finishing the profile, not "bananas waiting".
  const heading = phone ? 'Your free bananas are waiting 🍌' : 'Finish your GongbuLeng profile 🗣️'
  const subject = phone ? 'Your free bananas are waiting 🍌 · Tus plátanos gratis te esperan' : 'Finish your GongbuLeng profile 🗣️ · Completa tu perfil'
  return {
    subject,
    ...renderEmail({
      heading,
      paragraphs: [`Hi ${name}, you signed up for GongbuLeng, but your account isn’t finished yet${phone ? ', so you can’t join a class' : ''}. It takes about a minute:`],
      box: en,
      button: { label: 'Finish my account', url: URL },
      footnote: `Hola ${firstName || ''}: te registraste en GongbuLeng, pero tu cuenta aún no está completa. ${es.join(' · ')}. Termínala en gongbuleng.com/dashboard. · You get this email once because your account isn’t finished.`,
    }),
  }
}

async function targets() {
  const { data, error } = await supabase.from('users')
    .select('id, email, first_name, phone_verified, teach_language, learn_languages, suspended_until')
    .is('deleted_at', null)
  if (error) throw error
  const admins = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim())
  const now = new Date()
  return data
    .filter(u => !OWNER_IDS.has(u.id))
    .filter(u => u.email && !u.email.endsWith('.invalid') && !admins.includes(u.email.toLowerCase()))
    .filter(u => !(u.suspended_until && new Date(u.suspended_until) > now))
    .map(u => ({ ...u, phone: missingPhone(u), langs: missingLanguages(u) }))
    .filter(u => u.phone || u.langs)
}

async function run(argv) {
  const sent = new Set(fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [])
  const list = (await targets()).filter(u => !sent.has(u.email.toLowerCase()))
  const version = u => (u.phone && u.langs ? 'A (phone + languages)' : u.phone ? 'A (phone only)' : 'B (languages only)')
  console.log(`${list.length} member(s) to email${sent.size ? ` (${sent.size} already emailed, skipped)` : ''}:`)
  for (const u of list) console.log(`  #${u.id} ${u.first_name || '(no name)'} · version ${version(u)}`)

  const testTo = argv.includes('--test') && argv[argv.indexOf('--test') + 1]
  if (testTo) {
    for (const flags of [{ phone: true, langs: true }, { phone: false, langs: true }]) await sendEmail({ to: testTo, ...comeBackEmail('Hamin', flags) })
    console.log(`2 sample emails sent to ${testTo}`)
    return
  }
  if (!argv.includes('--send')) { console.log('dry run: nothing sent'); return }
  const { count, error } = await supabase.from('users').select('id', { count: 'exact', head: true }).is('deleted_at', null)
  if (error) throw error
  if (count < SEND_AT_MEMBERS) { console.log(`${count} members, waiting for ${SEND_AT_MEMBERS}: nothing sent`); return }
  let n = 0
  for (const u of list) {
    await sendEmail({ to: u.email, ...comeBackEmail(u.first_name, u) })
    sent.add(u.email.toLowerCase())
    fs.writeFileSync(LOG, JSON.stringify([...sent], null, 2))
    n++
    console.log(`  sent #${u.id}`)
  }
  console.log(`${n} sent`)
}

if (require.main === module) run(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1) })
module.exports = { comeBackEmail }
