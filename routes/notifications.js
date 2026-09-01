const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { fail } = require('../utils/failure')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// GET /api/notifications — most recent first, capped so this stays cheap
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) return fail(res, 400, 'Could not fetch notifications', error)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch notifications' })
  }
})

// POST /api/notifications/:id/read
router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)

    if (error) return fail(res, 400, 'Could not mark notification read', error)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not mark notification read' })
  }
})

module.exports = router
