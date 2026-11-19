// "People want to learn your language": emails members who teach a language
// with learners waiting and no class of theirs coming up.
//
//   node scripts/teachNudge.js                  # dry run: who would get it, sends nothing
//   node scripts/teachNudge.js --test me@x.com  # one sample email to that address only
//   node scripts/teachNudge.js --send           # sends, and stamps users.teach_nudge_sent_at
//
// Rules in utils/teachNudge.js (shouldNudge): opted in (Settings), nothing
// scheduled, at least 1 learner and no class at all in the language, not
// emailed in the last 14 days. Each
// member's stamp is re-read just before sending, so a second run at the same
// time skips whoever the first one already mailed.
//
// ponytail: run by hand for now; move into the cron once the owner is happy
// with who it reaches.

require('dotenv').config({ quiet: true })
const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('../utils/mailer')
const { teachDemand, shouldNudge, teachNudgeEmail } = require('../utils/teachNudge')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

async function targets() {
  const { data: teachers, error } = await supabase.from('users')
    .select('id, email, first_name, teach_language, notification_preferences, teach_nudge_sent_at')
    .not('teach_language', 'is', null).not('email', 'is', null)
    .eq('phone_verified', true).is('deleted_at', null)
  if (error) throw error
  const list = []
  for (const t of teachers) {
    // Some profiles saved an empty string rather than null.
    if (!t.teach_language?.trim()) continue
    const d = await teachDemand(t.teach_language, t.id)
    if (shouldNudge({ prefs: t.notification_preferences, sentAt: t.teach_nudge_sent_at, ownUpcoming: d.own_upcoming, learners: d.learners, upcoming: d.upcoming })) {
      list.push({ ...t, ...d })
    }
  }
  return list
}

async function run(argv) {
  const list = await targets()
  console.log(`${list.length} member(s) would get it:`)
  for (const t of list) console.log(`  #${t.id} ${t.first_name || ''} · ${t.teach_language} · ${t.learners} learning · ${t.upcoming} class(es) coming up`)

  const testTo = argv[argv.indexOf('--test') + 1]
  if (argv.includes('--test') && testTo) {
    const sample = list[0] || { first_name: 'there', teach_language: 'DE', learners: 3, upcoming: 0 }
    const mail = teachNudgeEmail({ firstName: sample.first_name, code: sample.teach_language, learners: sample.learners, upcoming: sample.upcoming })
    await sendEmail({ to: testTo, ...mail })
    console.log(`sample sent to ${testTo}`)
    return
  }
  if (!argv.includes('--send')) { console.log('dry run: nothing sent'); return }

  let sent = 0
  for (const t of list) {
    const { data: fresh } = await supabase.from('users').select('teach_nudge_sent_at').eq('id', t.id).single()
    if (!shouldNudge({ prefs: t.notification_preferences, sentAt: fresh?.teach_nudge_sent_at, ownUpcoming: t.own_upcoming, learners: t.learners, upcoming: t.upcoming })) continue
    const mail = teachNudgeEmail({ firstName: t.first_name, code: t.teach_language, learners: t.learners, upcoming: t.upcoming })
    await sendEmail({ to: t.email, ...mail })
    await supabase.from('users').update({ teach_nudge_sent_at: new Date().toISOString() }).eq('id', t.id)
    sent++
    console.log(`  sent #${t.id}`)
  }
  console.log(`${sent} sent`)
}

if (require.main === module) run(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1) })
