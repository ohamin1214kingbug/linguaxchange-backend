const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { recordWeeklyActivity } = require('../utils/streak')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

router.use(requireAuth, requireAdmin)

router.get('/users', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch users' })
  }
})

router.get('/classes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('classes')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch classes' })
  }
})

router.post('/users/:id/approve', async (req, res) => {
  try {
    const { error } = await supabase
      .from('users')
      .update({ is_approved: true })
      .eq('id', req.params.id)
    if (error) return res.status(400).json({ error: error.message })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not approve user' })
  }
})

router.post('/users/:id/reject', async (req, res) => {
  try {
    const { error } = await supabase
      .from('users')
      .update({ is_approved: false, approval_reason: 'Rejected by admin' })
      .eq('id', req.params.id)
    if (error) return res.status(400).json({ error: error.message })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not reject user' })
  }
})

// POST /api/admin/classes/:id/complete
// Record-keeping/moderation only — does NOT grant credit. Credit is earned
// solely via students confirming attendance (routes/enrollments.js
// POST /:id/confirm), which scales with how many students the teacher
// actually served instead of paying a flat amount regardless of class size.
// This still drives the teacher's weekly streak and the badges "taught"
// count, both of which key off classes.status = 'completed', not credits.
router.post('/classes/:id/complete', async (req, res) => {
  try {
    // Get the class to find the teacher
    const { data: cls, error: classError } = await supabase
      .from('classes')
      .select('teacher_id, status')
      .eq('id', req.params.id)
      .single()

    if (classError || !cls) {
      return res.status(404).json({ error: 'Class not found' })
    }

    // Mark class as completed
    await supabase
      .from('classes')
      .update({ status: 'completed' })
      .eq('id', req.params.id)

    // Teacher taught a class this week — counts toward their weekly activity streak
    await recordWeeklyActivity(cls.teacher_id)

    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not complete class' })
  }
})
module.exports = router
