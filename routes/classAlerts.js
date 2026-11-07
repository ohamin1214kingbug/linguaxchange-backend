const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { fail } = require('../utils/failure')
const { validateAlert } = require('../utils/classAlerts')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// GET /api/class-alerts — mine.
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('class_alerts')
    .select('language_code, level, created_at')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false })
  if (error) return fail(res, 400, 'Could not fetch your class alerts', error)
  res.json(data || [])
})

// POST /api/class-alerts { language_code, level } — level '' or absent means
// any level. Following the same thing twice is a no-op, not an error.
router.post('/', requireAuth, async (req, res) => {
  const alert = { language_code: req.body.language_code, level: req.body.level || '' }
  const invalid = validateAlert(alert)
  if (invalid) return res.status(400).json({ error: invalid })

  const { error } = await supabase
    .from('class_alerts')
    .upsert([{ user_id: req.userId, ...alert }], { onConflict: 'user_id,language_code,level' })
  if (error) return fail(res, 400, 'Could not save the alert', error)
  res.status(201).json(alert)
})

// DELETE /api/class-alerts?language_code=KO&level=A2
router.delete('/', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('class_alerts')
    .delete()
    .eq('user_id', req.userId)
    .eq('language_code', req.query.language_code || '')
    .eq('level', req.query.level || '')
  if (error) return fail(res, 400, 'Could not remove the alert', error)
  res.json({ success: true })
})

module.exports = router
