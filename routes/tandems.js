// Tandem partners (migrations/add_tandems.sql): two members who teach each
// other's languages practise one-to-one, free, no bananas. Only members who
// switched on tandem_open are listed. A hello waits for Accept / Not now;
// once accepted the pair gets a private chat (chat_messages, thread_type
// 'tandem') and a video room (routes/video.js, tandem_id). Phone and email
// are never shown.
const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { chatPostLimiter } = require('../middleware/rateLimit')
const { cleanMessage } = require('../utils/chatAccess')
const { tandemMatches, tandemRole, cleanHello } = require('../utils/tandem')
const { pushNotifications } = require('../utils/push')
const { sendEmail } = require('../utils/mailer')
const { renderEmail } = require('../utils/emailTemplate')
const { FRONTEND_URL } = require('../utils/frontendUrl')
const { fail } = require('../utils/failure')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const PUBLIC = 'id, first_name, photo_url, profile_color, teach_language, learn_languages, learn_details'
const LIVE = ['pending', 'accepted']

async function notify(userId, type, message) {
  const rows = [{ user_id: userId, type, message }]
  const { error } = await supabase.from('notifications').insert(rows)
  if (error) console.error('[TANDEM_NOTIFY]', error.message)
  else pushNotifications(rows)
}

// The tandem and this member's place in it, or null when not theirs.
async function loadTandem(id, userId) {
  const { data } = await supabase.from('tandems').select('*').eq('id', id).maybeSingle()
  const role = tandemRole(data, userId)
  return role ? { tandem: data, role, otherId: role === 'requester' ? data.partner_id : data.requester_id } : null
}

// GET /api/tandems — my opt-in, my matches and my live tandems.
router.get('/', requireAuth, async (req, res) => {
  try {
    const now = new Date().toISOString()
    const [{ data: me }, { data: open }, { data: mine }] = await Promise.all([
      supabase.from('users').select('id, teach_language, learn_languages, tandem_open').eq('id', req.userId).single(),
      supabase.from('users').select(PUBLIC).eq('tandem_open', true).is('deleted_at', null)
        .or(`suspended_until.is.null,suspended_until.lt.${now}`).neq('id', req.userId).limit(1000),
      supabase.from('tandems').select('*').or(`requester_id.eq.${req.userId},partner_id.eq.${req.userId}`)
        .in('status', LIVE).order('created_at', { ascending: false }),
    ])
    const otherOf = t => (t.requester_id === req.userId ? t.partner_id : t.requester_id)
    const liveWith = new Set((mine || []).map(otherOf))
    const candidates = (open || []).filter(u => !liveWith.has(u.id))
    const { data: survey } = await supabase.from('survey_responses').select('user_id, times')
      .in('user_id', [req.userId, ...candidates.map(u => u.id)])
    const times = Object.fromEntries((survey || []).map(s => [s.user_id, s.times || []]))

    const { data: others } = liveWith.size
      ? await supabase.from('users').select(PUBLIC).in('id', [...liveWith])
      : { data: [] }
    const byId = Object.fromEntries((others || []).map(u => [u.id, u]))
    res.json({
      open: Boolean(me?.tandem_open),
      has_languages: Boolean(me?.teach_language?.trim()) && (me?.learn_languages || []).some(Boolean),
      matches: tandemMatches(me || { id: req.userId }, candidates, { times }),
      tandems: (mine || []).map(t => ({
        id: t.id, status: t.status, message: t.message, created_at: t.created_at,
        incoming: t.partner_id === req.userId, other: byId[otherOf(t)] || { id: otherOf(t), first_name: '' },
      })),
    })
  } catch (e) {
    console.error('[TANDEMS]', e.message)
    res.status(500).json({ error: 'Could not load tandems' })
  }
})

// PUT /api/tandems/open {open} — show me on (or hide me from) the list.
router.put('/open', requireAuth, async (req, res) => {
  const open = req.body?.open === true
  const { error } = await supabase.from('users').update({ tandem_open: open }).eq('id', req.userId)
  if (error) return fail(res, 400, 'Could not save', error)
  res.json({ open })
})

// Pure: the email a member gets for a hello. Exported for its test.
function helloEmail({ firstName, fromName, message }) {
  return {
    subject: `${fromName || 'A member'} wants to be your tandem partner on GongbuLeng`,
    ...renderEmail({
      heading: 'Someone wants to practise with you 🤝',
      paragraphs: [`Hi ${firstName || 'there'}, ${fromName || 'a member'} would like to be your tandem partner: you help each other with your languages, free and one-to-one.`],
      box: [['Their hello:', message]],
      button: { label: 'Answer', url: `${FRONTEND_URL}/tandem` },
      footnote: 'Your email and phone stay private. If you choose "Not now", they are not told why.',
    }),
  }
}

// POST /api/tandems {partner_id, message} — say hello.
router.post('/', requireAuth, chatPostLimiter, async (req, res) => {
  const message = cleanHello(req.body?.message)
  const partnerId = parseInt(req.body?.partner_id)
  if (!message) return res.status(400).json({ error: 'Write a short hello (up to 300 characters)' })
  if (!partnerId || partnerId === req.userId) return res.status(400).json({ error: 'Choose a member' })
  try {
    const [{ data: partner }, { data: me }] = await Promise.all([
      supabase.from('users').select('id, first_name, email, tandem_open, deleted_at').eq('id', partnerId).maybeSingle(),
      supabase.from('users').select('first_name').eq('id', req.userId).single(),
    ])
    if (!partner?.tandem_open || partner.deleted_at) return res.status(400).json({ error: 'This member is not open to a tandem' })
    const { data, error } = await supabase.from('tandems')
      .insert([{ requester_id: req.userId, partner_id: partnerId, message }]).select('id').single()
    // The unique index on live pairs refuses a second hello.
    if (error?.code === '23505') return res.status(409).json({ error: 'You already have a tandem or a hello waiting with this member' })
    if (error) return fail(res, 400, 'Could not send', error)
    res.status(201).json({ id: data.id })
    notify(partnerId, 'tandem_request', `${me?.first_name || 'A member'} wants to be your tandem partner`)
      .catch(e => console.error('[TANDEM_HELLO]', e.message))
    if (partner.email && !partner.email.endsWith('.invalid')) {
      sendEmail({ to: partner.email, ...helloEmail({ firstName: partner.first_name, fromName: me?.first_name, message }) })
        .catch(e => console.error('[TANDEM_HELLO] email', e.message))
    }
  } catch (e) {
    console.error('[TANDEM_HELLO]', e.message)
    res.status(500).json({ error: 'Could not send' })
  }
})

// POST /api/tandems/:id/respond {accept} — only the member who got the hello.
router.post('/:id/respond', requireAuth, async (req, res) => {
  try {
    const t = await loadTandem(req.params.id, req.userId)
    if (t?.role !== 'partner') return res.status(403).json({ error: 'Not your hello to answer' })
    if (t.tandem.status !== 'pending') return res.status(400).json({ error: 'Already answered' })
    const status = req.body?.accept === true ? 'accepted' : 'declined'
    const { error } = await supabase.from('tandems')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('id', t.tandem.id).eq('status', 'pending')
    if (error) return fail(res, 400, 'Could not answer', error)
    res.json({ status })
    // "Not now" is silent: the hello just stops showing as waiting.
    if (status === 'accepted') {
      const { data: me } = await supabase.from('users').select('first_name').eq('id', req.userId).single()
      notify(t.otherId, 'tandem_accepted', `${me?.first_name || 'Your partner'} accepted your tandem. Say hi in your tandem chat!`)
        .catch(e => console.error('[TANDEM_RESPOND]', e.message))
    }
  } catch (e) {
    console.error('[TANDEM_RESPOND]', e.message)
    res.status(500).json({ error: 'Could not answer' })
  }
})

// POST /api/tandems/:id/end — either member; also withdraws a waiting hello.
router.post('/:id/end', requireAuth, async (req, res) => {
  try {
    const t = await loadTandem(req.params.id, req.userId)
    if (!t) return res.status(403).json({ error: 'Not your tandem' })
    if (!LIVE.includes(t.tandem.status)) return res.json({ status: t.tandem.status })
    const { error } = await supabase.from('tandems').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', t.tandem.id)
    if (error) return fail(res, 400, 'Could not end the tandem', error)
    res.json({ status: 'ended' })
  } catch (e) {
    console.error('[TANDEM_END]', e.message)
    res.status(500).json({ error: 'Could not end the tandem' })
  }
})

const toMessage = row => ({
  id: row.id, body: row.body, created_at: row.created_at, proposed_time: row.proposed_time,
  user_id: row.user_id, first_name: row.users?.first_name || '',
})

// GET /api/tandems/:id/chat?after=<message id> — readable once accepted,
// and after it ends (read-only).
router.get('/:id/chat', requireAuth, async (req, res) => {
  try {
    const t = await loadTandem(req.params.id, req.userId)
    if (!t || !['accepted', 'ended'].includes(t.tandem.status)) return res.status(403).json({ error: 'This chat opens once the hello is accepted' })
    let query = supabase.from('chat_messages')
      .select('id, body, created_at, proposed_time, user_id, users(first_name)')
      .eq('thread_type', 'tandem').eq('thread_id', t.tandem.id).is('deleted_at', null)
      .order('id', { ascending: true }).limit(300)
    const after = parseInt(req.query.after)
    if (after) query = query.gt('id', after)
    const [{ data, error }, { data: other }] = await Promise.all([
      query,
      supabase.from('users').select(PUBLIC).eq('id', t.otherId).maybeSingle(),
    ])
    if (error) return fail(res, 400, 'Could not load the chat', error)
    res.json({
      tandem: { id: t.tandem.id, status: t.tandem.status, message: t.tandem.message, incoming: t.role === 'partner' },
      open: t.tandem.status === 'accepted', other, messages: (data || []).map(toMessage),
    })
  } catch (e) {
    console.error('[TANDEM_CHAT]', e.message)
    res.status(500).json({ error: 'Could not load the chat' })
  }
})

// POST /api/tandems/:id/chat {body, proposed_time?} — either member may suggest a time.
router.post('/:id/chat', requireAuth, chatPostLimiter, async (req, res) => {
  const body = cleanMessage(req.body?.body)
  if (!body) return res.status(400).json({ error: 'Write a message of up to 500 characters' })
  try {
    const t = await loadTandem(req.params.id, req.userId)
    if (!t) return res.status(403).json({ error: 'Not your tandem' })
    if (t.tandem.status !== 'accepted') return res.status(403).json({ error: 'This chat has closed' })
    let proposed_time = null
    if (req.body?.proposed_time) {
      const when = new Date(req.body.proposed_time)
      if (isNaN(when) || when <= new Date()) return res.status(400).json({ error: 'Propose a time in the future' })
      proposed_time = when.toISOString()
    }
    const { data, error } = await supabase.from('chat_messages')
      .insert([{ thread_type: 'tandem', thread_id: t.tandem.id, user_id: req.userId, body, proposed_time }])
      .select('id, body, created_at, proposed_time, user_id, users(first_name)').single()
    if (error) return fail(res, 400, 'Could not send the message', error)
    res.status(201).json(toMessage(data))
    // At most one unread tandem-message notification per member.
    const { data: unread } = await supabase.from('notifications').select('id')
      .eq('user_id', t.otherId).eq('type', 'tandem_message').is('read_at', null).limit(1)
    if (!unread?.length) {
      notify(t.otherId, 'tandem_message', `${data.users?.first_name || 'Your partner'} wrote in your tandem chat`)
        .catch(e => console.error('[TANDEM_CHAT_NOTIFY]', e.message))
    }
  } catch (e) {
    console.error('[TANDEM_CHAT]', e.message)
    res.status(500).json({ error: 'Could not send the message' })
  }
})

module.exports = router
module.exports.helloEmail = helloEmail
module.exports.loadTandem = loadTandem
