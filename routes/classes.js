const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { sendEmail } = require('../utils/mailer')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

router.get('/', async (req, res) => {
  try {
    const query = supabase
      .from('classes')
      .select('*, teacher:users!teacher_id(id, first_name, last_name, photo_url), class_sessions(id, session_date, zoom_meeting_link, status)')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })

    if (req.query.teacher_id) {
      query.eq('teacher_id', req.query.teacher_id)
    }

    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch classes' })
  }
})

router.post('/', requireAuth, async (req, res) => {
  const {
    language_code, level, topic,
    title, description, max_students, duration_minutes,
    format, recurrence_type, materials, scheduled_at, meeting_link
  } = req.body

  if (!language_code || !level || !topic || !title) {
    return res.status(400).json({ error: 'language_code, level, topic, and title are required' })
  }
  if (!scheduled_at || isNaN(new Date(scheduled_at).getTime())) {
    return res.status(400).json({ error: 'A valid scheduled_at is required' })
  }
  if (new Date(scheduled_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'scheduled_at must be in the future' })
  }
  if (!Number.isInteger(parseInt(max_students)) || parseInt(max_students) < 1) {
    return res.status(400).json({ error: 'max_students must be a positive number' })
  }
  if (!Number.isInteger(parseInt(duration_minutes)) || parseInt(duration_minutes) < 1) {
    return res.status(400).json({ error: 'duration_minutes must be a positive number' })
  }

  try {
    const { data: cls, error } = await supabase
      .from('classes')
      .insert([{
        teacher_id: req.userId,
        language_code,
        level,
        topic,
        title,
        description,
        max_students: parseInt(max_students),
        duration_minutes: parseInt(duration_minutes),
        format,
        recurrence_type: recurrence_type || null,
        materials: materials || null,
        zoom_meeting_link: meeting_link || null,
        status: 'pending'
      }])
      .select()
      .single()

    if (error) {
      console.log('SUPABASE ERROR:', error)
      return res.status(400).json({ error: error.message })
    }

    const { error: sessionError } = await supabase
      .from('class_sessions')
      .insert([{
        class_id: cls.id,
        session_date: new Date(scheduled_at).toISOString(),
        zoom_meeting_link: meeting_link || null,
        status: 'scheduled'
      }])

    if (sessionError) {
      console.log('SESSION ERROR:', sessionError)
      return res.status(400).json({ error: sessionError.message })
    }

    res.status(201).json(cls)
  } catch (e) {
    console.log('CATCH ERROR:', e.message)
    res.status(500).json({ error: e.message })
  }
})

router.post('/:id/approve', requireAuth, requireAdmin, async (req, res) => {
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

router.post('/:id/reject', requireAuth, requireAdmin, async (req, res) => {
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

module.exports = router
