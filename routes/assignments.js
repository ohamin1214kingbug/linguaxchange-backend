const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { publicGetLimiter } = require('../middleware/rateLimit')
const { fail } = require('../utils/failure')
const { validateAssignmentRequest, expiresAt, MAX_OPEN_PER_USER } = require('../utils/assignmentValidation')
const { chargeForRequest, refundForRequest } = require('../utils/requestCredits')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// The student's name is shown; their email never is.
const SELECT = `
  id, language_code, level, prompt, body, expires_at, created_at, student_id,
  student:users!student_id(id, first_name, last_name, photo_url),
  assignment_feedback(
    id, reviewer_id, annotations, overall, created_at, acknowledged_at,
    reviewer:users!reviewer_id(id, first_name, last_name, photo_url,
                              university_domain, university_verified_at)
  )
`

// university_domain and university_verified_at are already in the public
// column whitelist; the pending and confirmed email columns are not and must
// stay out.

// GET /api/assignments — the open board. Public, like the class-request
// board: the point is that reviewers can see demand before signing up.
// Expiry is evaluated here rather than by a cleanup job, matching
// routes/classRequests.js — nothing reads stale rows, so deleting them buys
// nothing.
router.get('/', publicGetLimiter, async (req, res) => {
  try {
    let query = supabase
      .from('assignment_requests')
      .select(SELECT)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (req.query.language_code) {
      query = query.eq('language_code', String(req.query.language_code).toUpperCase())
    }

    const { data, error } = await query
    if (error) return fail(res, 400, 'Could not fetch assignment requests', error)
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not fetch assignment requests' })
  }
})

// GET /api/assignments/:id — one request, expired or not.
//
// Separate from the board because the board filters on expires_at: an
// answered request passes its expiry and disappears from the list, but its own
// page must keep working for the student who is about to acknowledge it.
router.get('/:id', publicGetLimiter, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('assignment_requests')
      .select(SELECT)
      .eq('id', req.params.id)
      .maybeSingle()

    if (error) return fail(res, 400, 'Could not fetch the request', error)
    if (!data) return res.status(404).json({ error: 'Request not found' })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not fetch the request' })
  }
})

// POST /api/assignments
router.post('/', requireAuth, async (req, res) => {
  const check = validateAssignmentRequest(req.body)
  if (!check.ok) return res.status(400).json({ error: check.error })

  try {
    const { count } = await supabase
      .from('assignment_requests')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', req.userId)
      .gt('expires_at', new Date().toISOString())

    if ((count || 0) >= MAX_OPEN_PER_USER) {
      return res.status(400).json({
        error: `You already have ${MAX_OPEN_PER_USER} open requests. Wait for one to be answered or withdraw it.`
      })
    }

    // Charged before the row exists, so a student who cannot afford feedback
    // never posts a request for it. If the insert then fails the banana goes
    // straight back — inserting first would leave a free request standing
    // whenever the charge failed.
    const charge = await chargeForRequest(req.userId)
    if (!charge.ok) return res.status(400).json({ error: charge.error })

    const { ok, ...fields } = check
    const { data, error } = await supabase
      .from('assignment_requests')
      .insert([{ ...fields, student_id: req.userId, expires_at: expiresAt().toISOString() }])
      .select(SELECT)
      .single()

    if (error) {
      await refundForRequest(req.userId, 'Assignment request could not be posted')
      return fail(res, 400, 'Could not post your request', error)
    }
    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not post your request' })
  }
})

// DELETE /api/assignments/:id — withdraw your own, only while unanswered.
//
// Once someone has written feedback the work is done and the banana is theirs
// to be released. A withdrawal that clawed it back would make reviewing unsafe,
// which is the one thing this economy cannot afford at its current size.
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { data: existing } = await supabase
      .from('assignment_requests')
      .select('id, assignment_feedback(id)')
      .eq('id', req.params.id)
      .eq('student_id', req.userId)
      .maybeSingle()

    if (!existing) return res.status(404).json({ error: 'Request not found' })
    if ((existing.assignment_feedback || []).length > 0) {
      return res.status(400).json({ error: 'This has already been answered — acknowledge it instead' })
    }

    // Conditional delete returning the row: the refund happens only if this
    // call is the one that removed it, so a double click cannot refund twice.
    const { data: deleted, error } = await supabase
      .from('assignment_requests')
      .delete()
      .eq('id', req.params.id)
      .eq('student_id', req.userId)
      .is('credit_refunded_at', null)
      .select('id')

    if (error) return fail(res, 400, 'Could not withdraw your request', error)
    if (!deleted || deleted.length === 0) return res.status(404).json({ error: 'Request not found' })

    await refundForRequest(req.userId, 'Assignment request withdrawn')
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not withdraw your request' })
  }
})

const { validateFeedback } = require('../utils/assignmentValidation')
const { isOverCap, countFeedbackEarnings, releaseFeedbackCredit } = require('../utils/assignmentCredits')

// POST /api/assignments/:id/feedback — answer a request.
//
// First response wins, and that is enforced by the unique constraint on
// request_id rather than by checking first and racing.
router.post('/:id/feedback', requireAuth, async (req, res) => {
  try {
    const { data: request } = await supabase
      .from('assignment_requests')
      .select('id, student_id, language_code, body, expires_at')
      .eq('id', req.params.id)
      .maybeSingle()

    if (!request) return res.status(404).json({ error: 'Request not found' })
    if (new Date(request.expires_at) <= new Date()) {
      return res.status(400).json({ error: 'This request has expired' })
    }
    if (request.student_id === req.userId) {
      return res.status(400).json({ error: "You can't answer your own request" })
    }

    // The only permission gate: the reviewer speaks the language natively.
    // A university restriction was considered and rejected — with one verified
    // user it would starve the feature before it had any.
    const { data: reviewer } = await supabase
      .from('users')
      .select('teach_language')
      .eq('id', req.userId)
      .maybeSingle()

    if (!reviewer || reviewer.teach_language !== request.language_code) {
      return res.status(403).json({ error: 'You can only give feedback in your own native language' })
    }

    const earned = await countFeedbackEarnings(req.userId)
    if (isOverCap(earned)) {
      return res.status(400).json({ error: "You've reached this week's feedback limit. Teach a class to keep earning." })
    }

    const check = validateFeedback(req.body, request.body)
    if (!check.ok) return res.status(400).json({ error: check.error })

    const { data, error } = await supabase
      .from('assignment_feedback')
      .insert([{
        request_id: request.id,
        reviewer_id: req.userId,
        annotations: check.annotations,
        overall: check.overall,
      }])
      .select('id, created_at')
      .single()

    if (error) {
      // 23505 is the unique violation on request_id: somebody answered first.
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Someone answered this first' })
      }
      return fail(res, 400, 'Could not save your feedback', error)
    }

    // Best effort. A failed notification must not fail the feedback that was
    // already written.
    await supabase.from('notifications').insert([{
      user_id: request.student_id,
      type: 'assignment_answered',
      message: 'Your writing has feedback',
    }])

    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not save your feedback' })
  }
})

// POST /api/assignments/:id/acknowledge — the student releases the banana.
//
// Same shape as attendance confirmation: the recipient releases the credit
// rather than the provider claiming the work is done. Idempotent by
// conditional transition, so a double click pays once.
router.post('/:id/acknowledge', requireAuth, async (req, res) => {
  try {
    const { data: request } = await supabase
      .from('assignment_requests')
      .select('id, student_id')
      .eq('id', req.params.id)
      .eq('student_id', req.userId)
      .maybeSingle()

    if (!request) return res.status(404).json({ error: 'Request not found' })

    const now = new Date().toISOString()
    const { data: released, error } = await supabase
      .from('assignment_feedback')
      .update({ acknowledged_at: now, credit_released_at: now })
      .eq('request_id', request.id)
      .is('credit_released_at', null)
      .select('id, reviewer_id')

    if (error) return fail(res, 400, 'Could not acknowledge the feedback', error)

    // No row transitioned: already released, by an earlier click or by the
    // cron's automatic release. Report success — the outcome the caller wanted
    // is already true.
    if (!released || released.length === 0) {
      return res.json({ success: true, already: true })
    }

    const payout = await releaseFeedbackCredit(released[0].reviewer_id)
    if (!payout.ok) {
      // The claim above already flipped credit_released_at. A retryable
      // failure must not leave that standing, or the row is stuck "released"
      // with no pay and no retry — clearing it means a second click, or the
      // cron sweep once AUTO_RELEASE_HOURS has passed, will claim and pay
      // this row again. A non-retryable failure (the credit was granted and
      // could not be reversed, see releaseFeedbackCredit) must NOT be
      // cleared — retrying would pay the reviewer a second time, so the
      // claim is left standing on purpose and the desync is logged loudly.
      if (payout.retryable) {
        const { error: clearError } = await supabase
          .from('assignment_feedback')
          .update({ credit_released_at: null })
          .eq('id', released[0].id)
        if (clearError) {
          console.error(
            'acknowledge: could not un-claim feedback', released[0].id,
            '— row is now stuck marked released with NO payout and will never be retried, needs a manual fix',
            clearError
          )
        }
      } else {
        console.error(
          'acknowledge: feedback', released[0].id, 'reviewer', released[0].reviewer_id,
          'was paid but its audit row and reversal both failed — balance and audit log are out of sync;',
          'leaving credit_released_at set to avoid a double payout, needs a manual fix'
        )
      }
      return res.status(500).json({ success: false, error: 'Acknowledged, but the credit release failed. Try again.' })
    }
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not acknowledge the feedback' })
  }
})

module.exports = router
