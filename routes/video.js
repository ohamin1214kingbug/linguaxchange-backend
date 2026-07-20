const express = require('express')
const router = express.Router()
const jwt = require('jsonwebtoken')
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// POST /api/video/signature - generate a Zoom Video SDK join signature
router.post('/signature', requireAuth, async (req, res) => {
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

    if (!process.env.ZOOM_SDK_KEY || !process.env.ZOOM_SDK_SECRET) {
      return res.status(503).json({ error: 'Video is not configured yet' })
    }

    const sessionName = `class-session-${class_session_id}`
    const roleType = isTeacher ? 1 : 0
    const iat = Math.round(Date.now() / 1000) - 30
    const exp = iat + 60 * 60 * 2

    const signature = jwt.sign(
      {
        app_key: process.env.ZOOM_SDK_KEY,
        tpc: sessionName,
        role_type: roleType,
        version: 1,
        iat,
        exp
      },
      process.env.ZOOM_SDK_SECRET,
      { algorithm: 'HS256' }
    )

    res.json({
      signature,
      sdkKey: process.env.ZOOM_SDK_KEY,
      sessionName,
      userIdentity: `user-${req.userId}`,
      topic: session.classes.title
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not generate video signature' })
  }
})

module.exports = router
