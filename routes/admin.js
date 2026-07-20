const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('../utils/mailer')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

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

router.post('/classes/:id/approve', async (req, res) => {
  try {
    const { data: cls, error } = await supabase
      .from('classes')
      .update({ status: 'approved' })
      .eq('id', req.params.id)
      .select('id, title, teacher_id')
      .single()
    if (error) return res.status(400).json({ error: error.message })

    const { data: teacher } = await supabase
      .from('users')
      .select('email, first_name')
      .eq('id', cls.teacher_id)
      .single()

    await sendEmail({
      to: teacher?.email,
      subject: `Your class '${cls.title}' has been approved!`,
      text: `Hi ${teacher?.first_name}, your class is now live and students can join.`
    })

    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not approve class' })
  }
})

router.post('/classes/:id/reject', async (req, res) => {
  try {
    const { error } = await supabase
      .from('classes')
      .update({ status: 'rejected' })
      .eq('id', req.params.id)
    if (error) return res.status(400).json({ error: error.message })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not reject class' })
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
    await supabase
      .from('credits')
      .update({ balance: supabase.raw('balance + 1') })
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
