const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth, requireAdmin } = require('../middleware/auth')

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

    // Give teacher exactly 1 credit
    const { data: teacherCredit } = await supabase
      .from('credits')
      .select('balance')
      .eq('user_id', cls.teacher_id)
      .single()

    await supabase
      .from('credits')
      .update({ balance: (teacherCredit?.balance || 0) + 1 })
      .eq('user_id', cls.teacher_id)

    // Record the transaction
    await supabase
      .from('credit_transactions')
      .insert([{
        user_id: cls.teacher_id,
        amount: 1,
        type: 'earned',
        description: 'Taught a class',
        related_class_id: parseInt(req.params.id)
      }])

    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not complete class' })
  }
})
module.exports = router
