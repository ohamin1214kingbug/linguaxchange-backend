// Chat messages are not kept forever (privacy policy, section 4):
// - 90 days after a chat closes, its messages are deleted. A class chat
//   closes 24h after the class (utils/chatAccess.js); a request chat closes
//   when the request expires (utils/requestChat.js); a tandem chat closes
//   when either member ends the tandem (routes/tandems.js).
// - A message the member deleted (deleted_at) is removed for good after 30 days.
// - Messages written by someone with a pending report against them stay
//   until the report is handled: they may be the evidence.
// Runs from the scheduled job (routes/cron.js). Deletes are permanent.
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const DAY_MS = 24 * 60 * 60 * 1000
const KEEP_AFTER_CLOSE_DAYS = 90
const KEEP_DELETED_DAYS = 30
// ponytail: a class chat closes 24h after the class ends; assumes classes
// last at most 4h rather than reading each class's length.
const SESSION_CLOSE_MS = DAY_MS + 4 * 60 * 60 * 1000
const BATCH = 500

// Pure. The dates before which threads count as expired.
function retentionCutoffs(now = new Date()) {
  const expired = now.getTime() - KEEP_AFTER_CLOSE_DAYS * DAY_MS
  return {
    sessionsBefore: new Date(expired - SESSION_CLOSE_MS).toISOString(),
    requestsBefore: new Date(expired).toISOString(),
    deletedBefore: new Date(now.getTime() - KEEP_DELETED_DAYS * DAY_MS).toISOString(),
  }
}

async function purgeChats(now = new Date()) {
  const cut = retentionCutoffs(now)
  const { data: reports } = await supabase.from('reports').select('reported_id')
    .eq('status', 'pending').eq('report_type', 'user')
  const protectedIds = [...new Set((reports || []).map(r => r.reported_id))]
  const keepReported = q => (protectedIds.length ? q.not('user_id', 'in', `(${protectedIds.join(',')})`) : q)

  const [{ data: sessions }, { data: requests }, { data: tandems }] = await Promise.all([
    supabase.from('class_sessions').select('id').lt('session_date', cut.sessionsBefore).limit(BATCH),
    supabase.from('class_requests').select('id').lt('expires_at', cut.requestsBefore).limit(BATCH),
    supabase.from('tandems').select('id').lt('ended_at', cut.requestsBefore).limit(BATCH),
  ])
  let removed = 0
  const purge = async q => {
    const { data, error } = await keepReported(q).select('id')
    if (error) console.error('[CHAT_RETENTION]', error.message)
    removed += (data || []).length
  }
  const sessionIds = (sessions || []).map(s => s.id)
  const requestIds = (requests || []).map(r => r.id)
  if (sessionIds.length) await purge(supabase.from('chat_messages').delete().eq('thread_type', 'session').in('thread_id', sessionIds))
  if (requestIds.length) await purge(supabase.from('chat_messages').delete().eq('thread_type', 'request').in('thread_id', requestIds))
  const tandemIds = (tandems || []).map(t => t.id)
  if (tandemIds.length) await purge(supabase.from('chat_messages').delete().eq('thread_type', 'tandem').in('thread_id', tandemIds))
  await purge(supabase.from('chat_messages').delete().lt('deleted_at', cut.deletedBefore))
  return { removed }
}

module.exports = { purgeChats, retentionCutoffs, KEEP_AFTER_CLOSE_DAYS, KEEP_DELETED_DAYS }
