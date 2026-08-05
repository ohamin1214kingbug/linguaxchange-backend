const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { publicGetLimiter } = require('../middleware/rateLimit')
const { validateRequest, expiresAt, MAX_OPEN_PER_USER } = require('../utils/classRequests')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const SELECT = '*, student:users!student_id(id, first_name, last_name, photo_url), class_request_interest(user_id)'

// Loads a request only while it's still answerable — open and unexpired.
// Expiry is enforced on read rather than by a cleanup job: nothing looks at
// stale rows, so deleting them buys nothing.
// ponytail: rows accumulate forever; add a nightly purge if the table ever
// gets big enough to notice.
async function getOpenRequest(id) {
  const { data } = await supabase
    .from('class_requests')
    .select('*')
    .eq('id', id)
    .is('fulfilled_class_id', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  return data
}

// GET /api/class-requests — the open board, newest first. Public, same as
// browsing classes: the whole point is that teachers can see the demand.
router.get('/', publicGetLimiter, async (req, res) => {
  try {
    let query = supabase
      .from('class_requests')
      .select(SELECT)
      .is('fulfilled_class_id', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (req.query.language_code) query = query.eq('language_code', req.query.language_code)
    if (req.query.level) query = query.eq('level', req.query.level)

    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    res.json(data || [])
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch class requests' })
  }
})

// POST /api/class-requests
router.post('/', requireAuth, async (req, res) => {
  const check = validateRequest(req.body)
  if (!check.ok) return res.status(400).json({ error: check.error })

  try {
    const { count } = await supabase
      .from('class_requests')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', req.userId)
      .is('fulfilled_class_id', null)
      .gt('expires_at', new Date().toISOString())

    if ((count || 0) >= MAX_OPEN_PER_USER) {
      return res.status(400).json({ error: `You already have ${MAX_OPEN_PER_USER} open requests. Wait for one to expire or withdraw it first.` })
    }

    const { ok, ...fields } = check
    const { data, error } = await supabase
      .from('class_requests')
      .insert([{ ...fields, student_id: req.userId, expires_at: expiresAt().toISOString() }])
      .select(SELECT)
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not post your request' })
  }
})

// DELETE /api/class-requests/:id — withdraw your own before it expires.
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('class_requests')
      .delete()
      .eq('id', req.params.id)
      .eq('student_id', req.userId)
      .select('id')

    if (error) return res.status(400).json({ error: error.message })
    if (!data || data.length === 0) return res.status(404).json({ error: 'Request not found' })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not withdraw your request' })
  }
})

// POST /api/class-requests/:id/interest — toggle "+1, me too". Idempotent
// per click: the row either exists or it doesn't, and the PK makes a
// double-click a no-op rather than a duplicate.
router.post('/:id/interest', requireAuth, async (req, res) => {
  try {
    const request = await getOpenRequest(req.params.id)
    if (!request) return res.status(404).json({ error: 'This request is no longer open' })
    if (request.student_id === req.userId) {
      return res.status(400).json({ error: 'This is your own request' })
    }

    const { data: existing } = await supabase
      .from('class_request_interest')
      .select('user_id')
      .eq('request_id', request.id)
      .eq('user_id', req.userId)
      .maybeSingle()

    if (existing) {
      await supabase.from('class_request_interest')
        .delete().eq('request_id', request.id).eq('user_id', req.userId)
      return res.json({ interested: false })
    }

    const { error } = await supabase
      .from('class_request_interest')
      .insert([{ request_id: request.id, user_id: req.userId }])

    if (error) return res.status(400).json({ error: error.message })
    res.json({ interested: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not update your interest' })
  }
})

// POST /api/class-requests/:id/fulfill — a teacher answered this request by
// creating a class. Closes the request and tells everyone who wanted it,
// which is the entire payoff of the board: without this the people who
// asked never find out a class exists.
router.post('/:id/fulfill', requireAuth, async (req, res) => {
  const classId = parseInt(req.body.class_id)
  if (!classId) return res.status(400).json({ error: 'class_id is required' })

  try {
    const request = await getOpenRequest(req.params.id)
    if (!request) return res.status(404).json({ error: 'This request is no longer open' })

    const { data: cls } = await supabase
      .from('classes')
      .select('id, title, teacher_id, class_sessions(id, session_date)')
      .eq('id', classId)
      .single()

    if (!cls || cls.teacher_id !== req.userId) {
      return res.status(403).json({ error: 'You do not teach that class' })
    }

    const { error } = await supabase
      .from('class_requests')
      .update({ fulfilled_class_id: cls.id })
      .eq('id', request.id)
      .is('fulfilled_class_id', null)

    if (error) return res.status(400).json({ error: error.message })

    const { data: interested } = await supabase
      .from('class_request_interest')
      .select('user_id')
      .eq('request_id', request.id)

    // The requester plus everyone who +1'd, deduped in case they overlap.
    const userIds = [...new Set([request.student_id, ...(interested || []).map(i => i.user_id)])]
    const firstSession = (cls.class_sessions || [])
      .slice()
      .sort((a, b) => new Date(a.session_date) - new Date(b.session_date))[0]

    await supabase.from('notifications').insert(userIds.map(user_id => ({
      user_id,
      type: 'request_fulfilled',
      class_session_id: firstSession?.id || null,
      message: `Someone is teaching '${request.topic}' — '${cls.title}' is now open`
    })))

    res.json({ success: true, notified: userIds.length })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not link the class to this request' })
  }
})

module.exports = router
