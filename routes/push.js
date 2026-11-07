const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { fail } = require('../utils/failure')
const { PUBLIC_KEY, enabled } = require('../utils/push')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// GET /api/push/key — the public VAPID key the browser subscribes with, or
// 404 while push isn't configured (the settings switch then stays hidden).
router.get('/key', (req, res) => {
  if (!enabled) return res.status(404).json({ error: 'Push notifications are not set up' })
  res.json({ key: PUBLIC_KEY })
})

// POST /api/push/subscribe { endpoint, keys: { p256dh, auth } } — the
// browser's PushSubscription as JSON.
router.post('/subscribe', requireAuth, async (req, res) => {
  const { endpoint, keys } = req.body || {}
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'That is not a push subscription' })
  }
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert([{ user_id: req.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth }], { onConflict: 'endpoint' })
  if (error) return fail(res, 400, 'Could not turn on notifications', error)
  res.status(201).json({ success: true })
})

// DELETE /api/push/subscribe { endpoint } — this device only.
router.delete('/subscribe', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', req.userId)
    .eq('endpoint', String(req.body?.endpoint || ''))
  if (error) return fail(res, 400, 'Could not turn off notifications', error)
  res.json({ success: true })
})

module.exports = router
