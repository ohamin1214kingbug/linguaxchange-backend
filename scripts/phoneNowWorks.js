// One-off (2026-11-24): on this day the owner switched on SMS in Twilio
// Verify's Geo Permissions for 24 more countries. Members who signed up
// with Google from those countries never got a phone code, through no fault
// of theirs; this tells them, once, that it works now.
//
//   node scripts/phoneNowWorks.js                  # dry run: counts by country, sends nothing
//   node scripts/phoneNowWorks.js --test me@x.com  # one sample copy to that address only
//   node scripts/phoneNowWorks.js --send           # everyone listed, once
//
// Country comes from the member's timezone (where they are, which is where
// their phone number is from), not their nationality. Skips verified
// phones, admins, the owner's accounts (#7, #9), suspended and deleted
// accounts. Sent addresses are added to .come-back-sent.json, the
// come-back email's log, so a later come-back run (scripts/comeBack.js)
// doesn't email them a second time.
require('dotenv').config({ quiet: true })
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('../utils/mailer')
const { renderEmail } = require('../utils/emailTemplate')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
const LOG = path.join(__dirname, '..', '.come-back-sent.json')
const URL = 'https://gongbuleng.com/dashboard'
const OWNER_IDS = new Set([7, 9])

// The 24 countries switched on 2026-11-24, by IANA timezone.
const COUNTRY_BY_TZ = {
  'Europe/Prague': 'Czechia', 'Europe/Bratislava': 'Slovakia', 'Europe/Budapest': 'Hungary', 'Europe/Sofia': 'Bulgaria',
  'Europe/Zagreb': 'Croatia', 'Europe/Ljubljana': 'Slovenia', 'Europe/Tallinn': 'Estonia', 'Europe/Riga': 'Latvia',
  'Europe/Vilnius': 'Lithuania', 'Europe/Luxembourg': 'Luxembourg', 'Asia/Nicosia': 'Cyprus', 'Asia/Famagusta': 'Cyprus',
  'Europe/Nicosia': 'Cyprus', 'Europe/Malta': 'Malta', 'Atlantic/Reykjavik': 'Iceland', 'Europe/Vaduz': 'Liechtenstein',
  'Europe/Istanbul': 'Turkey', 'Asia/Istanbul': 'Turkey', 'Europe/Belgrade': 'Serbia', 'Europe/Skopje': 'North Macedonia',
  'Europe/Andorra': 'Andorra', 'Asia/Riyadh': 'Saudi Arabia', 'Asia/Dubai': 'the UAE', 'Africa/Algiers': 'Algeria',
  'Africa/Lagos': 'Nigeria', 'Asia/Bangkok': 'Thailand', 'Asia/Kuala_Lumpur': 'Malaysia', 'Asia/Kuching': 'Malaysia',
}

// Pure: the email for one member.
// opts: url and footnote, for the one-to-one reply sent from the admin page
// (routes/admin.js, /blocked-reply); the defaults are this script's.
function phoneNowWorksEmail(firstName, country, { url = URL, footnote = 'Still no code? Write to gongbuleng.team@gmail.com and we’ll sort it out. You get this email once, because your phone couldn’t be verified.' } = {}) {
  return {
    subject: 'Your phone code works now 📱',
    ...renderEmail({
      heading: 'Sorry, the code never reached you 📱',
      paragraphs: [
        `Hi ${firstName || 'there'}, when you signed up for GongbuLeng, we couldn’t send a code to your phone. That was on our side, not yours: text messages to ${country} weren’t switched on yet.`,
        'They are now. Finishing your account takes about a minute:',
      ],
      box: [['📱 Verify your phone:', 'we text you a code'], ['🍌 Then:', 'your 3 free bananas arrive at once, enough for 3 classes']],
      button: { label: 'Verify my phone', url },
      footnote,
    }),
  }
}

async function targets() {
  const { data, error } = await supabase.from('users')
    .select('id, email, first_name, phone_verified, timezone, suspended_until')
    .is('deleted_at', null)
  if (error) throw error
  const admins = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim())
  const now = new Date()
  return data
    .filter(u => !u.phone_verified && COUNTRY_BY_TZ[u.timezone])
    .filter(u => !OWNER_IDS.has(u.id))
    .filter(u => u.email && !u.email.endsWith('.invalid') && !admins.includes(u.email.toLowerCase()))
    .filter(u => !(u.suspended_until && new Date(u.suspended_until) > now))
    .map(u => ({ ...u, country: COUNTRY_BY_TZ[u.timezone] }))
}

async function run(argv) {
  const sent = new Set(fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [])
  const list = (await targets()).filter(u => !sent.has(u.email.toLowerCase()))
  // Counts only: no names or addresses in the output.
  const byCountry = {}
  for (const u of list) byCountry[u.country] = (byCountry[u.country] || 0) + 1
  console.log(`${list.length} member(s) to email${sent.size ? ` (${sent.size} already emailed by a come-back run, skipped)` : ''}`)
  for (const [c, n] of Object.entries(byCountry)) console.log(`  ${c}: ${n}`)

  const testTo = argv.includes('--test') && argv[argv.indexOf('--test') + 1]
  if (testTo) {
    await sendEmail({ to: testTo, ...phoneNowWorksEmail('Hamin', 'Saudi Arabia') })
    console.log(`1 sample email sent to ${testTo}`)
    return
  }
  if (!argv.includes('--send')) { console.log('dry run: nothing sent'); return }
  let n = 0
  for (const u of list) {
    await sendEmail({ to: u.email, ...phoneNowWorksEmail(u.first_name, u.country) })
    sent.add(u.email.toLowerCase())
    fs.writeFileSync(LOG, JSON.stringify([...sent], null, 2))
    n++
    console.log(`  sent #${u.id}`)
  }
  console.log(`${n} sent`)
}

if (require.main === module) run(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1) })
module.exports = { phoneNowWorksEmail, COUNTRY_BY_TZ }
