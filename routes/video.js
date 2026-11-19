const express = require('express')
const router = express.Router()
const { recordJoin } = require('../utils/noShow')
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { buildRoomName } = require('../utils/roomName')
const { buildJaasToken } = require('../utils/jaasToken')
const { canJoinClassroom } = require('../utils/classroomAccess')
const { TANDEM_CALL_MINUTES } = require('../utils/tandem')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// POST /api/video/room - get the Jitsi room for a class session
router.post('/room', requireAuth, async (req, res) => {
  if (req.body?.tandem_id) return tandemRoom(req, res)
  if (req.body?.tandem_group_id) return tandemGroupRoom(req, res)
  const { class_session_id } = req.body
  if (!class_session_id) return res.status(400).json({ error: 'class_session_id is required' })

  try {
    const { data: session, error: sessionError } = await supabase
      .from('class_sessions')
      .select('id, session_date, classes(id, teacher_id, title, duration_minutes, description, materials, lesson_plan_url, level, language_code)')
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

    // Who actually came: the no-show rules (utils/noShow.js) read this.
    recordJoin(session.id, req.userId)

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
      .select('user_id, status, users(id, first_name, last_name, learn_details)')
      .eq('class_session_id', class_session_id)

    const { data: teacher } = await supabase
      .from('users')
      .select('id, first_name, last_name')
      .eq('id', session.classes.teacher_id)
      .single()

    const participants = roomParticipants({ teacher, enrolled, isTeacher, userId: req.userId })

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
      participants,
      // For the info panel beside the video: everyone here may already see
      // these on the class page.
      classInfo: (({ id, title, description, materials, lesson_plan_url, level, language_code, duration_minutes }) =>
        ({ id, title, description, materials, lesson_plan_url, level, language_code, duration_minutes }))(session.classes)
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not get video room' })
  }
})

// A tandem's room: both members, from 10 minutes before the agreed call
// (same window as a class teacher) until 30 minutes after it ends.
// Both are moderators (equal partners, and no "waiting for the host"); the room name is the same HMAC scheme as classes
// with a 'tandem-' prefix, so it can't collide with a session id.
async function tandemRoom(req, res) {
  try {
    const { loadTandem } = require('./tandems')
    const t = await loadTandem(req.body.tandem_id, req.userId)
    if (!t) return res.status(403).json({ error: 'Not your tandem' })
    if (t.tandem.status !== 'accepted') return res.status(403).json({ error: 'This tandem has ended' })
    if (!t.tandem.agreed_time) return res.status(403).json({ error: 'Agree a time in the chat first' })
    const window = canJoinClassroom({ sessionDate: t.tandem.agreed_time, durationMinutes: TANDEM_CALL_MINUTES, isTeacher: true })
    if (!window.ok) return res.status(403).json({ error: window.error.replace('classroom', 'video call').replace('class', 'call'), opens_at: window.opensAt || null })
    const appId = process.env.JAAS_APP_ID
    if (!appId || !process.env.JAAS_KID || !process.env.JAAS_PRIVATE_KEY) {
      console.error('[VIDEO] JaaS env vars missing - cannot issue a room token')
      return res.status(500).json({ error: 'Video is not configured' })
    }
    const { data: people } = await supabase.from('users').select('id, first_name, last_name').in('id', [req.userId, t.otherId])
    const me = (people || []).find(p => p.id === req.userId)
    const other = (people || []).find(p => p.id === t.otherId)
    const room = buildRoomName(`tandem-${t.tandem.id}`, process.env.JWT_SECRET)
    const displayName = `${me?.first_name || 'User'} ${me?.last_name || ''}`.trim()
    res.json({
      domain: '8x8.vc',
      roomName: `${appId}/${room}`,
      jwt: buildJaasToken({ appId, kid: process.env.JAAS_KID, privateKey: process.env.JAAS_PRIVATE_KEY, room, userId: req.userId, displayName, isModerator: true }),
      displayName,
      topic: `Tandem with ${other?.first_name || 'your partner'}`,
      isTeacher: false,
      participants: other ? [{ id: other.id, first_name: other.first_name, last_name: other.last_name, role: 'partner' }] : [],
      classInfo: null,
    })
  } catch (e) {
    console.error('[VIDEO_TANDEM]', e.message)
    res.status(500).json({ error: 'Could not get video room' })
  }
}

// A tandem group's room: its members, from 10 minutes before the call. The
// host is moderator. Room name: the HMAC scheme with a 'tgroup-' prefix.
async function tandemGroupRoom(req, res) {
  try {
    const { data: group } = await supabase.from('tandem_groups').select('*').eq('id', req.body.tandem_group_id).maybeSingle()
    if (!group || group.cancelled_at) return res.status(404).json({ error: 'This group was cancelled' })
    const { data: members } = await supabase.from('tandem_group_members')
      .select('user_id, side, users(id, first_name, last_name)').eq('group_id', group.id)
    const me = (members || []).find(m => m.user_id === req.userId)
    if (!me) return res.status(403).json({ error: 'Join the group first' })
    const window = canJoinClassroom({ sessionDate: group.starts_at, durationMinutes: group.duration_minutes, isTeacher: true })
    if (!window.ok) return res.status(403).json({ error: window.error.replace('classroom', 'video call').replace('class', 'call'), opens_at: window.opensAt || null })
    const appId = process.env.JAAS_APP_ID
    if (!appId || !process.env.JAAS_KID || !process.env.JAAS_PRIVATE_KEY) {
      console.error('[VIDEO] JaaS env vars missing - cannot issue a room token')
      return res.status(500).json({ error: 'Video is not configured' })
    }
    const room = buildRoomName(`tgroup-${group.id}`, process.env.JWT_SECRET)
    const displayName = `${me.users?.first_name || 'User'} ${me.users?.last_name || ''}`.trim()
    res.json({
      domain: '8x8.vc',
      roomName: `${appId}/${room}`,
      jwt: buildJaasToken({ appId, kid: process.env.JAAS_KID, privateKey: process.env.JAAS_PRIVATE_KEY, room, userId: req.userId, displayName, isModerator: group.host_id === req.userId }),
      displayName,
      topic: group.topic || `Tandem group ${group.lang_a} ⇄ ${group.lang_b}`,
      isTeacher: false,
      participants: (members || []).filter(m => m.user_id !== req.userId && m.users)
        .map(m => ({ id: m.users.id, first_name: m.users.first_name, last_name: m.users.last_name, role: m.user_id === group.host_id ? 'host' : 'member' })),
      classInfo: null,
    })
  } catch (e) {
    console.error('[VIDEO_TANDEM_GROUP]', e.message)
    res.status(500).json({ error: 'Could not get video room' })
  }
}

// Pure: who else is in the room. Cancelled places are left out. A
// student's level and note are for the teacher to pitch the class;
// classmates get names only.
function roomParticipants({ teacher, enrolled, isTeacher, userId }) {
  return [
    ...(teacher ? [{ ...teacher, role: 'teacher' }] : []),
    ...(enrolled || [])
      .filter(e => e.status !== 'cancelled')
      .map(e => e.users)
      .filter(Boolean)
      .map(({ learn_details, ...u }) => ({ ...u, role: 'student', ...(isTeacher ? { learn_details } : {}) })),
  ].filter(p => p.id !== userId)
}

module.exports = router
module.exports.roomParticipants = roomParticipants
