const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { STATUSES, validateReport } = require('../utils/reports')
const { fail } = require('../utils/failure')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// POST /api/reports — anyone signed in can flag a user or a class.
router.post('/', requireAuth, async (req, res) => {
  const check = validateReport(req.body)
  if (!check.ok) return res.status(400).json({ error: check.error })

  try {
    const { report_type, reported_type, reported_id, reason } = check
    const { data, error } = await supabase
      .from('reports')
      .insert([{ reporter_id: req.userId, report_type, reported_type, reported_id, reason, status: 'pending' }])
      .select()
      .single()

    if (error) return fail(res, 400, 'Could not submit report', error)
    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not submit report' })
  }
})

// GET /api/reports — admin queue, newest first.
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('reports')
      .select('*, reporter:users!reporter_id(id, first_name, last_name, email)')
      .order('created_at', { ascending: false })

    if (error) return fail(res, 400, 'Could not fetch reports', error)
    res.json(data || [])
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch reports' })
  }
})

// PATCH /api/reports/:id — admin sets status/notes after reviewing.
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { status, notes } = req.body
  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }

  try {
    const updates = { updated_at: new Date().toISOString() }
    if (status !== undefined) updates.status = status
    if (notes !== undefined) updates.notes = notes

    const { data, error } = await supabase
      .from('reports')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return fail(res, 400, 'Could not update report', error)
    if (!data) return res.status(404).json({ error: 'Report not found' })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not update report' })
  }
})

module.exports = router
