const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { chatPostLimiter } = require('../middleware/rateLimit')
const { cleanMessage } = require('../utils/chatAccess')
const { extendedExpiry, requestChatAccess, acceptTime } = require('../utils/requestChat')
const { pushNotifications } = require('../utils/push')
const { sendEmail } = require('../utils/mailer')
const { renderEmail } = require('../utils/emailTemplate')
const { FRONTEND_URL } = require('../utils/frontendUrl')
const { fail } = require('../utils/failure')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// The request with everyone who may take part, and this member's place.
async function loadRequest(requestId, userId) {
  const { data: request } = await supabase
    .from('class_requests')
    .select('id, student_id, language_code, level, topic, details, max_students, preferred_time, time_flexible, expires_at, created_at, fulfilled_class_id, agreed_time, agreed_teacher_id, student:users!student_id(first_name, email)')
    .eq('id', requestId)
    .maybeSingle()
  if (!request) return null
  const [{ data: interest }, { data: offers }] = await Promise.all([
    supabase.from('class_request_interest').select('user_id').eq('request_id', request.id),
    supabase.from('request_offers').select('teacher_id, teacher:users!teacher_id(first_name)').eq('request_id', request.id),
  ])
  const interestedIds = (interest || []).map(i => i.user_id)
  const teacherIds = (offers || []).map(o => o.teacher_id)
  return { request, interestedIds, teacherIds, offers: offers || [], ...requestChatAccess({ userId, request, interestedIds, teacherIds }) }
}

const members = thread => [...new Set([thread.request.student_id, ...thread.interestedIds, ...thread.teacherIds])]

// Teachers talking holds the refund clock (utils/requestChat.js).
async function holdClock(request) {
  const expires_at = extendedExpiry({ expiresAt: request.expires_at, createdAt: request.created_at }).toISOString()
  if (expires_at !== new Date(request.expires_at).toISOString()) {
    await supabase.from('class_requests').update({ expires_at }).eq('id', request.id).is('fulfilled_class_id', null)
  }
  return expires_at
}

// In-app + push for everyone in the chat except `fromId`; for messages, at
// most one unread notification per member per request.
async function notify(thread, fromId, type, message, { dedupe = false } = {}) {
  let to = members(thread).filter(id => id !== fromId)
  if (dedupe && to.length) {
    const { data: unread } = await supabase.from('notifications').select('user_id')
      .eq('type', type).eq('request_id', thread.request.id).is('read_at', null).in('user_id', to)
    const already = new Set((unread || []).map(n => n.user_id))
    to = to.filter(id => !already.has(id))
  }
  if (!to.length) return
  const rows = to.map(user_id => ({ user_id, type, request_id: thread.request.id, message }))
  const { error } = await supabase.from('notifications').insert(rows)
  if (error) console.error('[REQUEST_CHAT_NOTIFY]', error.message)
  else pushNotifications(rows)
}

const toMessage = (row, thread) => ({
  id: row.id, body: row.body, created_at: row.created_at, proposed_time: row.proposed_time,
  user_id: row.user_id, first_name: row.users?.first_name || '',
  is_teacher: thread.teacherIds.includes(row.user_id), is_requester: row.user_id === thread.request.student_id,
})

// GET /api/requests/:id/chat?after=<message id>
router.get('/:id/chat', requireAuth, async (req, res) => {
  try {
    const thread = await loadRequest(req.params.id, req.userId)
    if (!thread?.allowed) return res.status(403).json({ error: 'You are not part of this request' })
    let query = supabase.from('chat_messages')
      .select('id, body, created_at, proposed_time, user_id, users(first_name)')
      .eq('thread_type', 'request').eq('thread_id', thread.request.id).is('deleted_at', null)
      .order('id', { ascending: true }).limit(300)
    const after = parseInt(req.query.after)
    if (after) query = query.gt('id', after)
    const { data, error } = await query
    if (error) return fail(res, 400, 'Could not load the chat', error)
    const { student, ...request } = thread.request
    res.json({
      request: { ...request, student_first_name: student?.first_name || '' },
      open: thread.open, is_requester: thread.isRequester, is_teacher: thread.isTeacher,
      teachers: thread.offers.map(o => ({ id: o.teacher_id, first_name: o.teacher?.first_name || '' })),
      messages: (data || []).map(r => toMessage(r, thread)),
    })
  } catch (e) {
    console.error('[REQUEST_CHAT]', e.message)
    res.status(500).json({ error: 'Could not load the chat' })
  }
})

// POST /api/requests/:id/offer — "Offer to teach": joins the chat as a
// teacher, holds the refund clock, and tells the student by email.
router.post('/:id/offer', requireAuth, async (req, res) => {
  try {
    const thread = await loadRequest(req.params.id, req.userId)
    if (!thread) return res.status(404).json({ error: 'Request not found' })
    if (thread.isRequester) return res.status(400).json({ error: 'You cannot offer to teach your own request' })
    if (thread.request.fulfilled_class_id || new Date(thread.request.expires_at) <= new Date()) {
      return res.status(400).json({ error: 'This request is no longer open' })
    }
    const { data: me } = await supabase.from('users').select('first_name').eq('id', req.userId).single()
    const { error } = await supabase.from('request_offers')
      .upsert([{ request_id: thread.request.id, teacher_id: req.userId }], { onConflict: 'request_id,teacher_id', ignoreDuplicates: true })
    if (error) return fail(res, 400, 'Could not make the offer', error)
    const isNew = !thread.isTeacher
    await holdClock(thread.request)
    res.json({ success: true })
    if (isNew) {
      thread.teacherIds.push(req.userId)
      notify(thread, req.userId, 'request_offer', `${me?.first_name || 'A teacher'} offered to teach '${thread.request.topic}'`)
        .catch(e => console.error('[REQUEST_OFFER]', e.message))
      emailRequester(thread.request, me?.first_name).catch(e => console.error('[REQUEST_OFFER] email', e.message))
    }
  } catch (e) {
    console.error('[REQUEST_OFFER]', e.message)
    res.status(500).json({ error: 'Could not make the offer' })
  }
})

// Pure: the email the student gets when a teacher offers. Exported for its test.
function offerEmail({ firstName, teacherName, topic, requestId }) {
  return {
    subject: `${teacherName || 'A teacher'} wants to teach your request: ${topic}`,
    ...renderEmail({
      heading: 'A teacher offered to teach your request',
      paragraphs: [
        `Hi ${firstName || 'there'}, ${teacherName || 'a teacher'} would like to teach "${topic}".`,
        'Open the chat to agree on a time. Your request stays open while you talk.',
      ],
      button: { label: 'Open the chat', url: `${FRONTEND_URL}/chat/request/${requestId}` },
    }),
  }
}

async function emailRequester(request, teacherName) {
  if (!request.student?.email) return
  await sendEmail({ to: request.student.email, ...offerEmail({ firstName: request.student.first_name, teacherName, topic: request.topic, requestId: request.id }) })
}

// POST /api/requests/:id/chat — a message; the student who asked or a
// teacher who offered may attach a suggested time.
router.post('/:id/chat', requireAuth, chatPostLimiter, async (req, res) => {
  const body = cleanMessage(req.body?.body)
  if (!body) return res.status(400).json({ error: 'Write a message of up to 500 characters' })
  try {
    const thread = await loadRequest(req.params.id, req.userId)
    if (!thread?.allowed) return res.status(403).json({ error: 'You are not part of this request' })
    if (!thread.open) return res.status(403).json({ error: 'This chat has closed' })
    let proposed_time = null
    if (req.body?.proposed_time) {
      if (!thread.isTeacher && !thread.isRequester) return res.status(403).json({ error: 'Only the student who asked or a teacher who offered can suggest a time' })
      const when = new Date(req.body.proposed_time)
      if (isNaN(when) || when <= new Date()) return res.status(400).json({ error: 'Propose a time in the future' })
      proposed_time = when.toISOString()
    }
    const { data, error } = await supabase.from('chat_messages')
      .insert([{ thread_type: 'request', thread_id: thread.request.id, user_id: req.userId, body, proposed_time }])
      .select('id, body, created_at, proposed_time, user_id, users(first_name)').single()
    if (error) return fail(res, 400, 'Could not send the message', error)
    if (thread.isTeacher) await holdClock(thread.request)
    res.status(201).json(toMessage(data, thread))
    notify(thread, req.userId, 'request_chat', `${data.users?.first_name || 'Someone'} wrote about '${thread.request.topic}'`, { dedupe: true })
      .catch(e => console.error('[REQUEST_CHAT_NOTIFY]', e.message))
  } catch (e) {
    console.error('[REQUEST_CHAT]', e.message)
    res.status(500).json({ error: 'Could not send the message' })
  }
})

// POST /api/requests/:id/accept {message_id} — the student accepts a
// teacher's suggested time, or a teacher accepts the student's. The agreed
// teacher then creates the class at that time.
router.post('/:id/accept', requireAuth, async (req, res) => {
  try {
    const thread = await loadRequest(req.params.id, req.userId)
    if (!thread?.allowed) return res.status(403).json({ error: 'You are not part of this request' })
    if (!thread.open) return res.status(403).json({ error: 'This chat has closed' })
    const { data: msg } = await supabase.from('chat_messages')
      .select('id, user_id, proposed_time')
      .eq('id', req.body?.message_id).eq('thread_type', 'request').eq('thread_id', thread.request.id)
      .is('deleted_at', null).maybeSingle()
    if (!msg?.proposed_time) return res.status(400).json({ error: 'That is not a suggested time' })
    const rule = acceptTime({ proposerId: msg.user_id, accepterId: req.userId, studentId: thread.request.student_id, teacherIds: thread.teacherIds })
    if (!rule.ok) return res.status(403).json({ error: rule.error })
    const { error } = await supabase.from('class_requests')
      .update({ agreed_time: msg.proposed_time, agreed_teacher_id: rule.agreedTeacherId })
      .eq('id', thread.request.id)
    if (error) return fail(res, 400, 'Could not accept the time', error)
    res.json({ success: true, agreed_time: msg.proposed_time, agreed_teacher_id: rule.agreedTeacherId })
    notify(thread, req.userId, 'request_chat', rule.agreedTeacherId === req.userId
      ? `A time was agreed for '${thread.request.topic}'.`
      : `A time was agreed for '${thread.request.topic}'. Create the class.`)
      .catch(e => console.error('[REQUEST_ACCEPT]', e.message))
  } catch (e) {
    res.status(500).json({ error: 'Could not accept the time' })
  }
})

module.exports = router
module.exports.offerEmail = offerEmail
