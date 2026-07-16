const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// POST /api/enrollments - enroll in a class
router.post('/', async (req, res) => {
  const { user_id, class_id } = req.body
  try {
    const { data: credit } = await supabase
      .from('credits')
      .select('balance')
      .eq('user_id', user_id)
      .single()

    if (!credit || credit.balance < 1) {
      return res.status(400).json({ error: 'Not enough credits' })
    }

    // Create session first
    const { data: session, error: sessionError } = await supabase
      .from('class_sessions')
      .insert([{
        class_id: parseInt(class_id),
        session_date: new Date().toISOString(),
        status: 'scheduled'
      }])
      .select()
      .single()

    if (sessionError) {
      console.log('SESSION ERROR:', sessionError)
      return res.status(400).json({ error: sessionError.message })
    }

    // Enroll student
    const { data, error } = await supabase
      .from('class_enrollments')
      .insert([{
        class_session_id: session.id,
        user_id: parseInt(user_id),
        status: 'confirmed',
        attended: false
      }])
      .select()
      .single()

    if (error) {
      console.log('ENROLLMENT ERROR:', error)
      return res.status(400).json({ error: error.message })
    }

    // Deduct 1 credit
    await supabase
      .from('credits')
      .update({ balance: credit.balance - 1 })
      .eq('user_id', user_id)

    await supabase
      .from('credit_transactions')
      .insert([{
        user_id: parseInt(user_id),
        amount: -1,
        type: 'spent',
        description: 'Joined a class'
      }])

    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/enrollments/:id/confirm
router.post('/:id/confirm', async (req, res) => {
  const { user_id } = req.body
  try {
    const { data: enrollment, error } = await supabase
      .from('class_enrollments')
      .update({ attended: true, status: 'attended' })
      .eq('id', req.params.id)
      .eq('user_id', user_id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

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

    const { data: teacherCredit } = await supabase
      .from('credits')
      .select('balance')
      .eq('user_id', cls.teacher_id)
      .single()

    await supabase
      .from('credits')
      .update({ balance: (teacherCredit?.balance || 0) + 1 })
      .eq('user_id', cls.teacher_id)

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

// GET /api/enrollments?user_id=1
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

module.exports = router