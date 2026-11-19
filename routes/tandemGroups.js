// Tandem groups (migrations/add_tandem_groups.sql, owner request
// 2026-11-19): a free conversation swap between two languages, conversation
// only (no lesson, no host pay, so teaching classes stays worth it). Half
// the seats are for speakers of each language; you join on the side of the
// language you teach (users.teach_language). Members get a group chat open
// until 1 day after the call ends, and a video room from 10 minutes before
// (routes/video.js, tandem_group_id).
const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth, requireVerifiedPhone } = require('../middleware/auth')
const { chatPostLimiter } = require('../middleware/rateLimit')
const { cleanMessage } = require('../utils/chatAccess')
const { validateGroup, groupSide, groupChatOpen } = require('../utils/tandem')
const { alertLearners } = require('../utils/tandemAlerts')
const { LANGUAGE_NAMES } = require('../utils/classAlerts')
const { pushNotifications } = require('../utils/push')
const { fail } = require('../utils/failure')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const GROUP = 'id, host_id, lang_a, lang_b, starts_at, duration_minutes, size, topic, cancelled_at, created_at'
const MEMBER = 'group_id, user_id, side, users(id, first_name, photo_url)'
const name = code => LANGUAGE_NAMES[code] || code

// Pure: a group as one member sees it. Exported for its test.
function groupView(group, members, me) {
  const mine = members.find(m => m.user_id === me.id)
  const half = group.size / 2
  const side = k => members.filter(m => m.side === k).map(m => ({ id: m.user_id, first_name: m.users?.first_name || '', photo_url: m.users?.photo_url || null }))
  const a = side('a'), b = side('b')
  const mySide = mine?.side || groupSide(group, me.teach_language)
  const full = mySide ? (mySide === 'a' ? a : b).length >= half : false
  return {
    ...group, half, side_a: a, side_b: b,
    host_first_name: members.find(m => m.user_id === group.host_id)?.users?.first_name || '',
    joined: Boolean(mine), my_side: mySide, is_host: group.host_id === me.id,
    can_join: !mine && !group.cancelled_at && Boolean(mySide) && !full && new Date(group.starts_at) > new Date(),
    full, chat_open: Boolean(mine) && groupChatOpen(group),
  }
}

async function loadGroups(ids) {
  const { data: members } = await supabase.from('tandem_group_members').select(MEMBER).in('group_id', ids)
  return members || []
}

async function me(userId) {
  const { data } = await supabase.from('users').select('id, first_name, teach_language').eq('id', userId).single()
  return data || { id: userId }
}

async function notifyMembers(members, fromId, message) {
  const rows = members.filter(m => m.user_id !== fromId).map(m => ({ user_id: m.user_id, type: 'tandem_group', message }))
  if (!rows.length) return
  const { error } = await supabase.from('notifications').insert(rows)
  if (error) console.error('[TANDEM_GROUP_NOTIFY]', error.message)
  else pushNotifications(rows)
}

// GET /api/tandem-groups — groups that haven't ended yet, soonest first.
router.get('/', requireAuth, async (req, res) => {
  try {
    // ponytail: ends within 90 min of starting (longest length); filter the rest in code.
    const since = new Date(Date.now() - 90 * 60 * 1000).toISOString()
    const { data: groups, error } = await supabase.from('tandem_groups').select(GROUP)
      .is('cancelled_at', null).gte('starts_at', since).order('starts_at').limit(100)
    if (error) return fail(res, 400, 'Could not load groups', error)
    const viewer = await me(req.userId)
    const members = groups.length ? await loadGroups(groups.map(g => g.id)) : []
    const now = Date.now()
    res.json(groups
      .filter(g => new Date(g.starts_at).getTime() + g.duration_minutes * 60000 > now)
      .map(g => groupView(g, members.filter(m => m.group_id === g.id), viewer)))
  } catch (e) {
    console.error('[TANDEM_GROUPS]', e.message)
    res.status(500).json({ error: 'Could not load groups' })
  }
})

// POST /api/tandem-groups — start one; the host joins on their language's side.
router.post('/', requireAuth, requireVerifiedPhone, chatPostLimiter, async (req, res) => {
  const v = validateGroup(req.body)
  if (!v.ok) return res.status(400).json({ error: v.error })
  try {
    const host = await me(req.userId)
    const side = groupSide(v.group, host.teach_language)
    if (!side) return res.status(400).json({ error: 'One of the two languages must be the language you teach' })
    const { data: group, error } = await supabase.from('tandem_groups').insert([{ ...v.group, host_id: req.userId }]).select(GROUP).single()
    if (error) return fail(res, 400, 'Could not create the group', error)
    const { error: joinError } = await supabase.from('tandem_group_members').insert([{ group_id: group.id, user_id: req.userId, side }])
    if (joinError) {
      await supabase.from('tandem_groups').delete().eq('id', group.id)
      return fail(res, 400, 'Could not create the group', joinError)
    }
    res.status(201).json({ id: group.id })
    alertLearners({
      languages: [group.lang_a, group.lang_b], senderId: req.userId, type: 'tandem_group',
      message: `New tandem group: ${name(group.lang_a)} ⇄ ${name(group.lang_b)}, hosted by ${host.first_name || 'a member'}. Free, conversation only.`,
    }).catch(e => console.error('[TANDEM_GROUP_ALERT]', e.message))
  } catch (e) {
    console.error('[TANDEM_GROUP_CREATE]', e.message)
    res.status(500).json({ error: 'Could not create the group' })
  }
})

async function loadOne(id, userId) {
  const { data: group } = await supabase.from('tandem_groups').select(GROUP).eq('id', id).maybeSingle()
  if (!group) return null
  const members = await loadGroups([group.id])
  return { group, members, view: groupView(group, members, await me(userId)) }
}

// GET /api/tandem-groups/:id
router.get('/:id', requireAuth, async (req, res) => {
  const g = await loadOne(req.params.id, req.userId).catch(() => null)
  if (!g) return res.status(404).json({ error: 'Group not found' })
  res.json(g.view)
})

// POST /api/tandem-groups/:id/join
// ponytail: the seat check and insert aren't atomic, so two people joining
// the last seat at the same instant could overfill a side by one; move into
// a DB function if groups get busy.
router.post('/:id/join', requireAuth, requireVerifiedPhone, async (req, res) => {
  try {
    const g = await loadOne(req.params.id, req.userId)
    if (!g) return res.status(404).json({ error: 'Group not found' })
    if (g.view.joined) return res.json({ joined: true })
    if (!g.view.my_side) return res.status(400).json({ error: 'You join on the side of the language you teach, and it is not one of these two' })
    if (g.view.full) return res.status(409).json({ error: 'Your side is full' })
    if (!g.view.can_join) return res.status(400).json({ error: 'This group can no longer be joined' })
    const { error } = await supabase.from('tandem_group_members').insert([{ group_id: g.group.id, user_id: req.userId, side: g.view.my_side }])
    if (error) return fail(res, 400, 'Could not join', error)
    res.json({ joined: true })
    const viewer = await me(req.userId)
    notifyMembers(g.members.filter(m => m.user_id === g.group.host_id), req.userId,
      `${viewer.first_name || 'Someone'} joined your tandem group (${name(g.group.lang_a)} ⇄ ${name(g.group.lang_b)})`)
      .catch(e => console.error('[TANDEM_GROUP_JOIN]', e.message))
  } catch (e) {
    console.error('[TANDEM_GROUP_JOIN]', e.message)
    res.status(500).json({ error: 'Could not join' })
  }
})

// POST /api/tandem-groups/:id/leave — members; the host cancels instead.
router.post('/:id/leave', requireAuth, async (req, res) => {
  const g = await loadOne(req.params.id, req.userId).catch(() => null)
  if (!g?.view.joined) return res.status(400).json({ error: 'You are not in this group' })
  if (g.view.is_host) return res.status(400).json({ error: 'As the host, cancel the group instead' })
  const { error } = await supabase.from('tandem_group_members').delete().eq('group_id', g.group.id).eq('user_id', req.userId)
  if (error) return fail(res, 400, 'Could not leave', error)
  res.json({ joined: false })
})

// POST /api/tandem-groups/:id/cancel — host only; members get a bell.
router.post('/:id/cancel', requireAuth, async (req, res) => {
  const g = await loadOne(req.params.id, req.userId).catch(() => null)
  if (!g?.view.is_host) return res.status(403).json({ error: 'Only the host can cancel' })
  if (g.group.cancelled_at) return res.json({ cancelled: true })
  const { error } = await supabase.from('tandem_groups').update({ cancelled_at: new Date().toISOString() }).eq('id', g.group.id)
  if (error) return fail(res, 400, 'Could not cancel', error)
  res.json({ cancelled: true })
  notifyMembers(g.members, req.userId, `The tandem group ${name(g.group.lang_a)} ⇄ ${name(g.group.lang_b)} was cancelled by the host`)
    .catch(e => console.error('[TANDEM_GROUP_CANCEL]', e.message))
})

const toMessage = row => ({ id: row.id, body: row.body, created_at: row.created_at, user_id: row.user_id, first_name: row.users?.first_name || '' })

// GET /api/tandem-groups/:id/chat?after=<id> — members only.
router.get('/:id/chat', requireAuth, async (req, res) => {
  try {
    const g = await loadOne(req.params.id, req.userId)
    if (!g?.view.joined) return res.status(403).json({ error: 'Join the group to see its chat' })
    let query = supabase.from('chat_messages').select('id, body, created_at, user_id, users(first_name)')
      .eq('thread_type', 'tandem_group').eq('thread_id', g.group.id).is('deleted_at', null)
      .order('id', { ascending: true }).limit(300)
    const after = parseInt(req.query.after)
    if (after) query = query.gt('id', after)
    const { data, error } = await query
    if (error) return fail(res, 400, 'Could not load the chat', error)
    res.json({ group: g.view, open: g.view.chat_open, messages: (data || []).map(toMessage) })
  } catch (e) {
    console.error('[TANDEM_GROUP_CHAT]', e.message)
    res.status(500).json({ error: 'Could not load the chat' })
  }
})

// POST /api/tandem-groups/:id/chat {body}
router.post('/:id/chat', requireAuth, requireVerifiedPhone, chatPostLimiter, async (req, res) => {
  const body = cleanMessage(req.body?.body)
  if (!body) return res.status(400).json({ error: 'Write a message of up to 500 characters' })
  try {
    const g = await loadOne(req.params.id, req.userId)
    if (!g?.view.joined) return res.status(403).json({ error: 'Join the group to write here' })
    if (!g.view.chat_open) return res.status(403).json({ error: 'This chat has closed' })
    const { data, error } = await supabase.from('chat_messages')
      .insert([{ thread_type: 'tandem_group', thread_id: g.group.id, user_id: req.userId, body }])
      .select('id, body, created_at, user_id, users(first_name)').single()
    if (error) return fail(res, 400, 'Could not send the message', error)
    res.status(201).json(toMessage(data))
    // At most one unread group bell per member.
    const others = g.members.filter(m => m.user_id !== req.userId).map(m => m.user_id)
    if (!others.length) return
    const { data: unread } = await supabase.from('notifications').select('user_id')
      .eq('type', 'tandem_group').is('read_at', null).in('user_id', others)
    const skip = new Set((unread || []).map(n => n.user_id))
    notifyMembers(g.members.filter(m => !skip.has(m.user_id)), req.userId,
      `${data.users?.first_name || 'Someone'} wrote in your tandem group chat`)
      .catch(e => console.error('[TANDEM_GROUP_CHAT_NOTIFY]', e.message))
  } catch (e) {
    console.error('[TANDEM_GROUP_CHAT]', e.message)
    res.status(500).json({ error: 'Could not send the message' })
  }
})

module.exports = router
module.exports.groupView = groupView
