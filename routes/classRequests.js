const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { publicGetLimiter } = require('../middleware/rateLimit')
const { validateRequest, expiresAt, MAX_OPEN_PER_USER } = require('../utils/classRequests')
const { chargeForRequest, refundForRequest } = require('../utils/requestCredits')
const { isSessionFullError } = require('../utils/enrollmentCapacity')

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

// Seats the student who asked for the class, using the credit they already
// spent posting the request — no second charge.
//
// Returns false rather than throwing if it can't: the class exists either
// way and the teacher shouldn't see their own answer fail because of the
// requester's situation. When it can't seat them the credit goes back, so
// they're never left having paid for a class they aren't in.
async function enrolRequester(request, cls, firstSession) {
  if (!firstSession) {
    await refundForRequest(request.student_id, `No session to join for: ${request.topic}`)
    return false
  }

  try {
    // The teacher may have answered with a recurring class; take the first
    // session they aren't already in, same rule the normal join flow uses.
    const { data: mine } = await supabase
      .from('class_enrollments')
      .select('class_session_id')
      .eq('user_id', request.student_id)
      .eq('class_session_id', firstSession.id)

    if (mine && mine.length > 0) return true // already in it, nothing to do

    const { error } = await supabase
      .from('class_enrollments')
      .insert([{
        class_session_id: firstSession.id,
        user_id: request.student_id,
        status: 'confirmed',
        attended: false
      }])

    if (error) {
      // Full class, or anything else: the student paid for a seat they
      // didn't get, so give the credit back.
      const why = isSessionFullError(error)
        ? `Class was full: ${request.topic}`
        : `Could not join the class for: ${request.topic}`
      await refundForRequest(request.student_id, why)
      return false
    }
    return true
  } catch (e) {
    console.error('[REQUEST_FULFILL] could not enrol requester', e.message)
    await refundForRequest(request.student_id, `Could not join the class for: ${request.topic}`)
    return false
  }
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

    // Charged before the row exists, so a student who can't afford the class
    // never posts a request for it. If the insert then fails the credit is
    // handed straight back — the alternative, inserting first, would leave a
    // free request standing whenever the charge failed.
    const charge = await chargeForRequest(req.userId)
    if (!charge.ok) return res.status(400).json({ error: charge.error })

    const { ok, ...fields } = check
    const { data, error } = await supabase
      .from('class_requests')
      .insert([{ ...fields, student_id: req.userId, expires_at: expiresAt().toISOString() }])
      .select(SELECT)
      .single()

    if (error) {
      await refundForRequest(req.userId, 'Class request could not be posted')
      return res.status(400).json({ error: error.message })
    }
    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not post your request' })
  }
})

// DELETE /api/class-requests/:id — withdraw your own before it expires.
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    // The deleted row comes back, which is what makes the refund safe: only
    // the call that actually removed the row issues one, so a double-click
    // can't pay out twice.
    const { data, error } = await supabase
      .from('class_requests')
      .delete()
      .eq('id', req.params.id)
      .eq('student_id', req.userId)
      .select('id, topic, fulfilled_class_id, credit_refunded_at')

    if (error) return res.status(400).json({ error: error.message })
    if (!data || data.length === 0) return res.status(404).json({ error: 'Request not found' })

    // Only unfulfilled requests get the credit back. A fulfilled one already
    // bought the class the student was enrolled in, and an expired one may
    // have been refunded by the sweep already.
    const removed = data[0]
    const refunded = !removed.fulfilled_class_id && !removed.credit_refunded_at
    if (refunded) {
      await refundForRequest(req.userId, `Withdrew request: ${removed.topic}`)
    }
    res.json({ success: true, refunded })
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

    // The requester already paid when they posted, so put them in the class
    // rather than just telling them about it — being notified about a class
    // you asked for and still having to go join it (and pay again) is the
    // bug this fixes. The +1 crowd are only notified: they never paid, so
    // they join and pay normally like anyone else.
    const enrolled = await enrolRequester(request, cls, firstSession)

    await supabase.from('notifications').insert(userIds.map(user_id => ({
      user_id,
      type: 'request_fulfilled',
      class_session_id: firstSession?.id || null,
      message: user_id === request.student_id && enrolled
        ? `You're in — '${cls.title}' answers your request for '${request.topic}'`
        : `Someone is teaching '${request.topic}' — '${cls.title}' is now open`
    })))

    res.json({ success: true, notified: userIds.length, requesterEnrolled: enrolled })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not link the class to this request' })
  }
})

module.exports = router
