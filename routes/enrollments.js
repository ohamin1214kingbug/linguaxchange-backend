const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// POST /api/enrollments - enroll in a class
router.post('/', async (req, res) => {
  const { user_id, class_session_id } = req.body
  try {
    // Check user has enough credits
    const { data: credit } = await supabase
      .from('credits')
      .select('balance')
      .eq('user_id', user_id)
      .single()

    if (!credit || credit.balance < 1) {
      return res.status(400).json({ error: 'Not enough credits' })
    }

    // Enroll the student
    const { data, error } = await supabase
      .from('class_enrollments')
      .insert([{
        class_session_id,
        user_id,
        status: 'confirmed',
        attended: false
      }])
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    // Deduct 1 credit
    await supabase
      .from('credits')
      .update({ balance: credit.balance - 1 })
      .eq('user_id', user_id)

    // Record transaction
    await supabase
      .from('credit_transactions')
      .insert([{
        user_id,
        amount: -1,
        type: 'spent',
        description: 'Joined a class'
      }])

    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not enroll' })
  }
})

// POST /api/enrollments/:id/confirm - student confirms attendance
router.post('/:id/confirm', async (req, res) => {
  const { user_id } = req.body
  try {
    // Mark student as attended
    const { data: enrollment, error } = await supabase
      .from('class_enrollments')
      .update({ attended: true, status: 'attended' })
      .eq('id', req.params.id)
      .eq('user_id', user_id)
      .select('*, class_sessions(class_id)')
      .single()

    if (error) return res.status(400).json({ error: error.message })

    // Get the class to find the teacher
    const { data: session } = await supabase
      .from('class_sessions')
      .select('class_id')
      .eq('id', enrollment.class_session_id)
      .single()

    const { data: cls } = await supabase
      .from('classes')
      .select('teacher_id')
      .eq('id', session.class_id)
      .single()

    // Give teacher +1 credit
    const { data: teacherCredit } = await supabase
      .from('credits')
      .select('balance')
      .eq('user_id', cls.teacher_id)
      .single()

    await supabase
      .from('credits')
      .update({ balance: (teacherCredit?.balance || 0) + 1 })
      .eq('user_id', cls.teacher_id)

    // Record transaction for teacher
    await supabase
      .from('credit_transactions')
      .insert([{
        user_id: cls.teacher_id,
        amount: 1,
        type: 'earned',
        description: 'Student confirmed attendance'
      }])

    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not confirm attendance' })
  }
})

// GET /api/enrollments?user_id=1 - get user's enrollments
router.get('/', async (req, res) => {
  const { user_id } = req.query
  try {
    const { data, error } = await supabase
      .from('class_enrollments')
      .select('*, class_sessions(*, classes(*))')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch enrollments' })
  }
})
const enrollmentRoutes = require('./routes/enrollments')
app.use('/api/enrollments', enrollmentRoutes)
module.exports = router