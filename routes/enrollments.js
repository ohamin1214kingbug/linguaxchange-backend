const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('../utils/mailer')
const { requireAuth } = require('../middleware/auth')
const { pickNextUnjoinedSession } = require('../utils/pickSession')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// POST /api/enrollments - enroll in a class
router.post('/', requireAuth, async (req, res) => {
  const { class_id } = req.body
  const user_id = req.userId
  try {
    const { data: credit } = await supabase
      .from('credits')
      .select('balance')
      .eq('user_id', user_id)
      .single()

    if (!credit || credit.balance < 1) {
      return res.status(400).json({ error: 'Not enough credits' })
    }

    // Find the earliest scheduled session for this class the student hasn't already joined
    // (a recurring class has multiple sessions, so this lets a student book each occurrence in turn)
    const { data: sessions, error: sessionError } = await supabase
      .from('class_sessions')
      .select('id')
      .eq('class_id', parseInt(class_id))
      .eq('status', 'scheduled')
      .order('session_date', { ascending: true })

    if (sessionError) {
      console.log('SESSION ERROR:', sessionError)
      return res.status(400).json({ error: sessionError.message })
    }
    if (!sessions || sessions.length === 0) {
      return res.status(400).json({ error: 'No scheduled session for this class' })
    }

    const { data: myEnrollments } = await supabase
      .from('class_enrollments')
      .select('class_session_id')
      .eq('user_id', user_id)
      .in('class_session_id', sessions.map(s => s.id))

    const session = pickNextUnjoinedSession(sessions, (myEnrollments || []).map(e => e.class_session_id))

    if (!session) {
      return res.status(400).json({ error: 'Already joined all upcoming occurrences of this class' })
    }

    // Enroll student
    const { data, error } = await supabase
      .from('class_enrollments')
      .insert([{
        class_session_id: session.id,
        user_id,
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
        user_id,
        amount: -1,
        type: 'spent',
        description: 'Joined a class'
      }])

    const { data: cls } = await supabase
      .from('classes')
      .select('title, teacher_id')
      .eq('id', class_id)
      .single()

    const { data: teacher } = await supabase
      .from('users')
      .select('email, first_name')
      .eq('id', cls?.teacher_id)
      .single()

    const { data: student } = await supabase
      .from('users')
      .select('first_name, email')
      .eq('id', user_id)
      .single()

    await sendEmail({
      to: teacher?.email,
      subject: `A student joined '${cls?.title}'`,
      text: `Hi ${teacher?.first_name}, ${student?.first_name} has joined your class.`
    })

    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/enrollments/:id/confirm
router.post('/:id/confirm', requireAuth, async (req, res) => {
  const user_id = req.userId
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

// GET /api/enrollments
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('class_enrollments')
      .select('*, class_sessions(*, classes(*))')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch enrollments' })
  }
})

module.exports = router
