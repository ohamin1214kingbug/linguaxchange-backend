const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { buildRoomName } = require('../utils/roomName')
const { buildJaasToken } = require('../utils/jaasToken')
const { canJoinClassroom } = require('../utils/classroomAccess')

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
      .select('id, session_date, classes(id, teacher_id, title, duration_minutes)')
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

    // Checked here rather than only in the UI: the token is the only way into
    // the room, so refusing to mint one is what actually keeps a student out
    // of an empty classroom — hiding the dashboard link does not.
    const window = canJoinClassroom({
      sessionDate: session.session_date,
      durationMinutes: session.classes.duration_minutes,
      isTeacher
    })
    if (!window.ok) {
      return res.status(403).json({ error: window.error, opens_at: window.opensAt || null })
    }

    const { data: user } = await supabase
      .from('users')
      .select('first_name, last_name')
      .eq('id', req.userId)
      .single()

    const appId = process.env.JAAS_APP_ID
    if (!appId || !process.env.JAAS_KID || !process.env.JAAS_PRIVATE_KEY) {
      console.error('[VIDEO] JaaS env vars missing - cannot issue a room token')
      return res.status(500).json({ error: 'Video is not configured' })
    }

    // Who else is in this room, so someone can be reported from inside the
    // call rather than having to leave it, find a profile page and describe
    // the incident from memory afterwards.
    //
    // Nothing new is exposed: the class detail page already lists the
    // teacher and every enrolled student by name to anyone who can see the
    // class. Names only — no emails, no ids beyond the one already needed to
    // link to a profile.
    const { data: enrolled } = await supabase
      .from('class_enrollments')
      .select('user_id, users(id, first_name, last_name)')
      .eq('class_session_id', class_session_id)

    const { data: teacher } = await supabase
      .from('users')
      .select('id, first_name, last_name')
      .eq('id', session.classes.teacher_id)
      .single()

    const participants = [
      ...(teacher ? [{ ...teacher, role: 'teacher' }] : []),
      ...(enrolled || [])
        .map(e => e.users)
        .filter(Boolean)
        .map(u => ({ ...u, role: 'student' }))
    ].filter(p => p.id !== req.userId)

    const room = buildRoomName(class_session_id, process.env.JWT_SECRET)
    const displayName = `${user?.first_name || 'User'} ${user?.last_name || ''}`.trim()

    res.json({
      domain: '8x8.vc',
      // JaaS namespaces every room under the tenant/AppID; the JWT's `room`
      // claim stays the bare name.
      roomName: `${appId}/${room}`,
      jwt: buildJaasToken({
        appId,
        kid: process.env.JAAS_KID,
        privateKey: process.env.JAAS_PRIVATE_KEY,
        room,
        userId: req.userId,
        displayName,
        isModerator: isTeacher
      }),
      displayName,
      topic: session.classes.title,
      isTeacher,
      participants
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not get video room' })
  }
})

module.exports = router
