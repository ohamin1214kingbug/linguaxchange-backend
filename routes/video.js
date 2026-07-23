const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { buildRoomName } = require('../utils/roomName')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// POST /api/video/room - get the Jitsi room for a class session
router.post('/room', requireAuth, async (req, res) => {
  const { class_session_id } = req.body
  if (!class_session_id) return res.status(400).json({ error: 'class_session_id is required' })

  try {
    const { data: session, error: sessionError } = await supabase
      .from('class_sessions')
      .select('id, classes(teacher_id, title)')
      .eq('id', class_session_id)
      .single()

    if (sessionError || !session) return res.status(404).json({ error: 'Session not found' })

    const isTeacher = session.classes.teacher_id === req.userId
    let isEnrolled = false
    if (!isTeacher) {
      const { data: enrollment } = await supabase
        .from('class_enrollments')
        .select('id')
        .eq('class_session_id', class_session_id)
        .eq('user_id', req.userId)
        .maybeSingle()
      isEnrolled = !!enrollment
    }

    if (!isTeacher && !isEnrolled) {
      return res.status(403).json({ error: 'You are not part of this class' })
    }

    const { data: user } = await supabase
      .from('users')
      .select('first_name, last_name')
      .eq('id', req.userId)
      .single()

    res.json({
      roomName: buildRoomName(class_session_id, process.env.JWT_SECRET),
      displayName: `${user?.first_name || 'User'} ${user?.last_name || ''}`.trim(),
      topic: session.classes.title,
      isTeacher
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not get video room' })
  }
})

module.exports = router
