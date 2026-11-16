const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { chatPostLimiter } = require('../middleware/rateLimit')
const { chatAccess, cleanMessage } = require('../utils/chatAccess')
const { buildInbox } = require('../utils/chatInbox')
const { pushNotifications } = require('../utils/push')
const { fail } = require('../utils/failure')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// The session, its class, and this member's place in it.
async function loadThread(sessionId, userId) {
  const { data: session } = await supabase
    .from('class_sessions')
    .select('id, session_date, status, classes(id, title, teacher_id, duration_minutes)')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session?.classes) return null
  const isTeacher = session.classes.teacher_id === userId
  let enrollmentStatus = null
  if (!isTeacher) {
    const { data: enrollment } = await supabase
      .from('class_enrollments')
      .select('status')
      .eq('class_session_id', session.id)
      .eq('user_id', userId)
      .maybeSingle()
    enrollmentStatus = enrollment?.status || null
  }
  const access = chatAccess({
    isTeacher, enrollmentStatus,
    sessionDate: session.session_date, sessionStatus: session.status,
    durationMinutes: session.classes.duration_minutes,
  })
  return { session, cls: session.classes, isTeacher, ...access }
}

const toMessage = (row, teacherId) => ({
  id: row.id, body: row.body, created_at: row.created_at,
  user_id: row.user_id, first_name: row.users?.first_name || '', is_teacher: row.user_id === teacherId,
})

// GET /api/chat/session/:id?after=<message id> — the thread, or only what
// is newer than `after` (the page polls with it).
router.get('/session/:id', requireAuth, async (req, res) => {
  try {
    const thread = await loadThread(req.params.id, req.userId)
    if (!thread || !thread.allowed) return res.status(403).json({ error: 'You are not part of this class' })
    let query = supabase
      .from('chat_messages')
      .select('id, body, created_at, user_id, users(first_name)')
      .eq('thread_type', 'session').eq('thread_id', thread.session.id)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .limit(300)
    const after = parseInt(req.query.after)
    if (after) query = query.gt('id', after)
    const { data, error } = await query
    if (error) return fail(res, 400, 'Could not load the chat', error)
    res.json({
      session_id: thread.session.id, class_id: thread.cls.id, title: thread.cls.title,
      session_date: thread.session.session_date,
      open: thread.open, closes_at: thread.closesAt, is_teacher: thread.isTeacher,
      messages: (data || []).map(r => toMessage(r, thread.cls.teacher_id)),
    })
  } catch (e) {
    console.error('[CHAT]', e.message)
    res.status(500).json({ error: 'Could not load the chat' })
  }
})

const HOUR_MS = 60 * 60 * 1000

// GET /api/chat/mine — every chat this member can write in right now, with
// its newest message, for the dashboard's "Chats" panel (utils/chatInbox.js
// decides what is open and the order).
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const uid = req.userId
    const now = new Date()
    // ponytail: a chat stays open 24h after the class ends; assumes classes
    // last at most 4h. Taught sessions only for the next 7 days, so weekly
    // recurring classes do not flood the list.
    const since = new Date(now.getTime() - 28 * HOUR_MS).toISOString()
    const weekAhead = new Date(now.getTime() + 7 * 24 * HOUR_MS).toISOString()
    const SESSION = 'id, session_date, status, classes!inner(id, title, teacher_id, duration_minutes)'
    const [booked, taught, offers, interest] = await Promise.all([
      supabase.from('class_enrollments').select(`status, class_sessions!inner(${SESSION})`)
        .eq('user_id', uid).neq('status', 'cancelled').gte('class_sessions.session_date', since).limit(100),
      supabase.from('class_sessions').select(SESSION)
        .eq('classes.teacher_id', uid).neq('status', 'cancelled')
        .gte('session_date', since).lte('session_date', weekAhead).limit(100),
      supabase.from('request_offers').select('request_id').eq('teacher_id', uid),
      supabase.from('class_request_interest').select('request_id').eq('user_id', uid),
    ])
    const failed = [booked, taught, offers, interest].find(r => r.error)
    if (failed) return fail(res, 400, 'Could not load your chats', failed.error)

    const joinedIds = [...new Set([...offers.data, ...interest.data].map(r => r.request_id))]
    let requestQuery = supabase.from('class_requests').select('id, topic, student_id, expires_at, fulfilled_class_id')
      .is('fulfilled_class_id', null).gt('expires_at', now.toISOString())
    requestQuery = joinedIds.length
      ? requestQuery.or(`student_id.eq.${uid},id.in.(${joinedIds.join(',')})`)
      : requestQuery.eq('student_id', uid)
    const { data: requests, error: requestError } = await requestQuery
    if (requestError) return fail(res, 400, 'Could not load your chats', requestError)

    const sessions = [
      ...booked.data.map(e => ({ ...e.class_sessions, enrollmentStatus: e.status })),
      ...taught.data,
    ]
    // ponytail: newest 300 messages per kind; a thread quiet for longer than
    // that shows without a preview.
    const newest = (type, ids) => ids.length
      ? supabase.from('chat_messages').select('id, thread_type, thread_id, body, created_at, proposed_time, user_id, users(first_name)')
        .eq('thread_type', type).in('thread_id', ids).is('deleted_at', null).order('id', { ascending: false }).limit(300)
      : Promise.resolve({ data: [] })
    const [sm, rm] = await Promise.all([newest('session', sessions.map(s => s.id)), newest('request', (requests || []).map(r => r.id))])
    const messages = [...(sm.data || []), ...(rm.data || [])].sort((a, b) => b.id - a.id)

    res.json({ chats: buildInbox({ userId: uid, sessions, requests: requests || [], messages, now }) })
  } catch (e) {
    console.error('[CHAT_MINE]', e.message)
    res.status(500).json({ error: 'Could not load your chats' })
  }
})

// GET /api/chat/class/:classId — which session's chat this member should
// see on the class page: the earliest one they teach or booked that is
// still open. 404 when there is none.
router.get('/class/:classId', requireAuth, async (req, res) => {
  try {
    const { data: sessions } = await supabase
      .from('class_sessions')
      .select('id, session_date')
      .eq('class_id', req.params.classId)
      .neq('status', 'cancelled')
      .order('session_date', { ascending: true })
    for (const s of sessions || []) {
      const thread = await loadThread(s.id, req.userId)
      if (thread?.open) return res.json({ session_id: s.id })
    }
    res.status(404).json({ error: 'No open chat for you in this class' })
  } catch (e) {
    res.status(500).json({ error: 'Could not load the chat' })
  }
})

// POST /api/chat/session/:id — send a message.
router.post('/session/:id', requireAuth, chatPostLimiter, async (req, res) => {
  const body = cleanMessage(req.body?.body)
  if (!body) return res.status(400).json({ error: 'Write a message of up to 500 characters' })
  try {
    const thread = await loadThread(req.params.id, req.userId)
    if (!thread || !thread.allowed) return res.status(403).json({ error: 'You are not part of this class' })
    if (!thread.open) return res.status(403).json({ error: 'This chat has closed' })
    const { data, error } = await supabase
      .from('chat_messages')
      .insert([{ thread_type: 'session', thread_id: thread.session.id, user_id: req.userId, body }])
      .select('id, body, created_at, user_id, users(first_name)')
      .single()
    if (error) return fail(res, 400, 'Could not send the message', error)
    res.status(201).json(toMessage(data, thread.cls.teacher_id))
    notifyMembers(thread, req.userId, data.users?.first_name)
      .catch(e => console.error('[CHAT_NOTIFY]', e.message))
  } catch (e) {
    console.error('[CHAT]', e.message)
    res.status(500).json({ error: 'Could not send the message' })
  }
})

// One unread notification per member per chat at a time: a busy chat
// should light the bell once, not once per message.
async function notifyMembers(thread, senderId, senderName) {
  const { data: enrolled } = await supabase
    .from('class_enrollments')
    .select('user_id, status')
    .eq('class_session_id', thread.session.id)
  const members = [thread.cls.teacher_id, ...(enrolled || []).filter(e => e.status !== 'cancelled').map(e => e.user_id)]
  const others = [...new Set(members)].filter(id => id !== senderId)
  if (!others.length) return
  const { data: unread } = await supabase
    .from('notifications')
    .select('user_id')
    .eq('type', 'chat_message').eq('class_session_id', thread.session.id)
    .is('read_at', null)
    .in('user_id', others)
  const already = new Set((unread || []).map(n => n.user_id))
  const rows = others.filter(id => !already.has(id)).map(user_id => ({
    user_id, type: 'chat_message', class_session_id: thread.session.id,
    message: `${senderName || 'Someone'} wrote in the '${thread.cls.title}' chat`,
  }))
  if (!rows.length) return
  const { error } = await supabase.from('notifications').insert(rows)
  if (!error) pushNotifications(rows)
}

// DELETE /api/chat/messages/:id — by its author or the class's teacher.
router.delete('/messages/:id', requireAuth, async (req, res) => {
  try {
    const { data: msg } = await supabase
      .from('chat_messages')
      .select('id, user_id, thread_type, thread_id')
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!msg) return res.status(404).json({ error: 'Message not found' })
    let allowed = msg.user_id === req.userId
    if (!allowed && msg.thread_type === 'session') {
      const thread = await loadThread(msg.thread_id, req.userId)
      allowed = Boolean(thread?.isTeacher)
    }
    if (!allowed) return res.status(403).json({ error: 'You can only delete your own messages' })
    const { error } = await supabase.from('chat_messages').update({ deleted_at: new Date().toISOString() }).eq('id', msg.id)
    if (error) return fail(res, 400, 'Could not delete the message', error)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not delete the message' })
  }
})

module.exports = router
