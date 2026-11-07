const webpush = require('web-push')
const { createClient } = require('@supabase/supabase-js')

let client
function db() {
  if (!client) client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  return client
}

// Push is optional: without both VAPID keys in the environment nothing is
// sent and nothing fails, so the site runs the same as before.
const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const enabled = !!(PUBLIC_KEY && PRIVATE_KEY)
if (enabled) webpush.setVapidDetails('mailto:gongbuleng.team@gmail.com', PUBLIC_KEY, PRIVATE_KEY)

// Pure. Where tapping the notification goes; mirrors notificationHref in the
// frontend's Navbar so the bell menu and the phone agree.
function pushUrl(row) {
  if (row.type === 'class_started' && row.class_session_id) return `/classroom/${row.class_session_id}`
  if (row.type === 'request_fulfilled') return '/classes'
  return '/dashboard'
}

// Mirrors every in-app notification to the member's devices, right after it
// is saved. Never throws and never blocks the caller's response on failure:
// the in-app notification is the record, the push is a courtesy. A device
// that has unsubscribed (404/410) is forgotten.
async function pushNotifications(rows) {
  if (!enabled || !rows?.length) return 0
  try {
    const userIds = [...new Set(rows.map(r => r.user_id))]
    const { data: subs, error } = await db()
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', userIds)
    if (error) {
      console.error('[PUSH] could not read subscriptions:', error.message)
      return 0
    }

    let sent = 0
    for (const row of rows) {
      const payload = JSON.stringify({ title: 'GongbuLeng', body: row.message, url: pushUrl(row), tag: row.type })
      for (const sub of (subs || []).filter(s => s.user_id === row.user_id)) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 60 * 60 })
          sent++
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            await db().from('push_subscriptions').delete().eq('id', sub.id)
          } else {
            console.error('[PUSH] send failed for user', sub.user_id, e.statusCode || e.message)
          }
        }
      }
    }
    return sent
  } catch (e) {
    console.error('[PUSH] failed:', e.message)
    return 0
  }
}

module.exports = { PUBLIC_KEY, enabled, pushUrl, pushNotifications }
