// Bell alerts that bring people to tandems (owner plan A, 2026-11-19):
// "X is looking for a tandem" when someone switches on, and "new tandem
// group" when one is created. Sent to members who learn one of the
// languages, opted in or not, so new people discover tandems.
// Limits: bell + push only (no email), at most one of these per member per
// day, never the sender, never deleted or suspended members.
const { createClient } = require('@supabase/supabase-js')
const { pushNotifications } = require('./push')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const ALERT_TYPES = ['tandem_looking', 'tandem_group']
const DAY_MS = 24 * 60 * 60 * 1000
// ponytail: one batch of 500 learners per alert; page through when a
// language has more learners than that.
const MAX_RECIPIENTS = 500

// Pure: who still gets an alert today.
function alertRecipients(learnerIds, { senderId, excludeIds = [], alertedToday = [] }) {
  const skip = new Set([senderId, ...excludeIds, ...alertedToday])
  return [...new Set(learnerIds)].filter(id => !skip.has(id))
}

async function alertLearners({ languages, senderId, excludeIds = [], type, message, now = new Date() }) {
  const filter = languages.map(l => `learn_languages.cs.{${l}}`).join(',')
  const { data: learners, error } = await supabase.from('users').select('id, suspended_until')
    .or(filter).is('deleted_at', null).limit(MAX_RECIPIENTS)
  if (error) { console.error('[TANDEM_ALERT]', error.message); return 0 }
  const ids = (learners || []).filter(u => !(u.suspended_until && new Date(u.suspended_until) > now)).map(u => u.id)
  if (!ids.length) return 0
  const { data: recent } = await supabase.from('notifications').select('user_id')
    .in('type', ALERT_TYPES).in('user_id', ids)
    .gte('created_at', new Date(now.getTime() - DAY_MS).toISOString())
  const to = alertRecipients(ids, { senderId, excludeIds, alertedToday: (recent || []).map(r => r.user_id) })
  if (!to.length) return 0
  const rows = to.map(user_id => ({ user_id, type, message }))
  const { error: insertError } = await supabase.from('notifications').insert(rows)
  if (insertError) { console.error('[TANDEM_ALERT]', insertError.message); return 0 }
  pushNotifications(rows)
  return rows.length
}

module.exports = { alertLearners, alertRecipients }
