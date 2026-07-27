const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth, requireAdmin, isAdmin } = require('../middleware/auth')
const { sendEmail } = require('../utils/mailer')
const { buildSessionDates } = require('../utils/sessionDates')
const { hasFutureSession, cancelClass } = require('../utils/classCancellation')
const { sortBySoonest } = require('../utils/classSearch')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// GET /api/classes — all filters compose (AND together). q does a simple
// case-insensitive substring match on title/description; full-text-search
// infra would be overkill at this scale. Default (and only) sort is
// soonest-upcoming-session-first, computed in utils/classSearch.js since
// PostgREST can't order a parent query by a child table's aggregate.
router.get('/', async (req, res) => {
  try {
    let query = supabase
      .from('classes')
      .select('*, teacher:users!teacher_id(id, first_name, last_name, photo_url), class_sessions(id, session_date, zoom_meeting_link, status)')
      .eq('status', 'approved')
      .order('session_date', { foreignTable: 'class_sessions', ascending: true })

    if (req.query.teacher_id) {
      query = query.eq('teacher_id', req.query.teacher_id)
    }
    if (req.query.language_code) {
      query = query.eq('language_code', req.query.language_code)
    }
    if (req.query.level) {
      query = query.eq('level', req.query.level)
    }
    if (req.query.q) {
      // strip characters that have special meaning in PostgREST's .or() filter syntax
      const term = `%${req.query.q.replace(/[(),]/g, '')}%`
      query = query.or(`title.ilike.${term},description.ilike.${term}`)
    }

    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    res.json(sortBySoonest(data || []))
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch classes' })
  }
})

router.post('/', requireAuth, async (req, res) => {
  const {
    language_code, level, topic,
    title, description, max_students, duration_minutes,
    format, recurrence_type, recurrence_end_date, materials, scheduled_at, meeting_link
  } = req.body

  if (!language_code || !level || !topic || !title) {
    return res.status(400).json({ error: 'language_code, level, topic, and title are required' })
  }
  if (!scheduled_at || isNaN(new Date(scheduled_at).getTime())) {
    return res.status(400).json({ error: 'A valid scheduled_at is required' })
  }
  if (new Date(scheduled_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'scheduled_at must be in the future' })
  }
  if (!Number.isInteger(parseInt(max_students)) || parseInt(max_students) < 1) {
    return res.status(400).json({ error: 'max_students must be a positive number' })
  }
  if (!Number.isInteger(parseInt(duration_minutes)) || parseInt(duration_minutes) < 1) {
    return res.status(400).json({ error: 'duration_minutes must be a positive number' })
  }
  if (format === 'recurring') {
    if (!recurrence_type) {
      return res.status(400).json({ error: 'recurrence_type is required for recurring classes' })
    }
    if (!recurrence_end_date || isNaN(new Date(recurrence_end_date).getTime())) {
      return res.status(400).json({ error: 'A valid recurrence_end_date is required for recurring classes' })
    }
    if (new Date(recurrence_end_date).getTime() <= new Date(scheduled_at).getTime()) {
      return res.status(400).json({ error: 'recurrence_end_date must be after scheduled_at' })
    }
  }

  try {
    const { data: cls, error } = await supabase
      .from('classes')
      .insert([{
        teacher_id: req.userId,
        language_code,
        level,
        topic,
        title,
        description,
        max_students: parseInt(max_students),
        duration_minutes: parseInt(duration_minutes),
        format,
        recurrence_type: format === 'recurring' ? recurrence_type : null,
        recurrence_end_date: format === 'recurring' ? new Date(recurrence_end_date).toISOString() : null,
        materials: materials || null,
        zoom_meeting_link: meeting_link || null,
        status: 'pending'
      }])
      .select()
      .single()

    if (error) {
      console.log('SUPABASE ERROR:', error)
      return res.status(400).json({ error: error.message })
    }

    const sessionDates = format === 'recurring'
      ? buildSessionDates(scheduled_at, recurrence_type, recurrence_end_date)
      : [new Date(scheduled_at)]

    const { error: sessionError } = await supabase
      .from('class_sessions')
      .insert(sessionDates.map(date => ({
        class_id: cls.id,
        session_date: date.toISOString(),
        zoom_meeting_link: meeting_link || null,
        status: 'scheduled'
      })))

    if (sessionError) {
      console.log('SESSION ERROR:', sessionError)
      return res.status(400).json({ error: sessionError.message })
    }

    res.status(201).json({ ...cls, sessionCount: sessionDates.length })
  } catch (e) {
    console.log('CATCH ERROR:', e.message)
    res.status(500).json({ error: e.message })
  }
})

router.post('/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: cls, error } = await supabase
      .from('classes')
      .update({ status: 'approved' })
      .eq('id', req.params.id)
      .select('id, title, teacher_id')
      .single()
    if (error) return res.status(400).json({ error: error.message })

    const { data: teacher } = await supabase
      .from('users')
      .select('email, first_name')
      .eq('id', cls.teacher_id)
      .single()

    await sendEmail({
      to: teacher?.email,
      subject: `Your class '${cls.title}' has been approved!`,
      text: `Hi ${teacher?.first_name}, your class is now live and students can join.`
    })

    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not approve class' })
  }
})

router.post('/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('classes')
      .update({ status: 'rejected' })
      .eq('id', req.params.id)
    if (error) return res.status(400).json({ error: error.message })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not reject class' })
  }
})

// PATCH /api/classes/:id — title/description only. Time changes aren't
// supported here: with bookings possible and classes.status not having a
// per-time-slot concept once a class is recurring, the safer v1 answer is
// to force cancel + repost instead of allowing a time edit that could
// silently pull the rug out from under someone who already booked a slot.
router.patch('/:id', requireAuth, async (req, res) => {
  const { title, description } = req.body
  try {
    const { data: cls, error } = await supabase
      .from('classes')
      .select('id, teacher_id, status')
      .eq('id', req.params.id)
      .single()

    if (error || !cls) return res.status(404).json({ error: 'Class not found' })

    if (req.userId !== cls.teacher_id && !(await isAdmin(req.userId))) {
      return res.status(403).json({ error: 'Only the teacher who created this class (or an admin) can edit it' })
    }
    if (cls.status === 'cancelled') {
      return res.status(400).json({ error: 'This class has been cancelled and cannot be edited' })
    }

    const { data: sessions } = await supabase
      .from('class_sessions')
      .select('id, session_date, status')
      .eq('class_id', cls.id)

    if (!hasFutureSession(sessions)) {
      return res.status(400).json({ error: 'This class has already happened and cannot be edited' })
    }

    const updates = {}
    if (title !== undefined) updates.title = title
    if (description !== undefined) updates.description = description

    const { data: updated, error: updateError } = await supabase
      .from('classes')
      .update(updates)
      .eq('id', cls.id)
      .select()
      .single()

    if (updateError) return res.status(400).json({ error: updateError.message })
    res.json(updated)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not update class' })
  }
})

// POST /api/classes/:id/cancel
// Idempotent — cancelling an already-cancelled class just returns success
// with refundedCount: 0 rather than erroring or refunding a second time
// (see utils/classCancellation.js). Side effects (refund, notify, cascade
// to class_sessions so the reminder cron stops picking these up) all live
// there rather than in a plain status-field PATCH, since cancellation does
// a lot more than flip one column.
router.post('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const { data: cls, error } = await supabase
      .from('classes')
      .select('id, title, teacher_id, status')
      .eq('id', req.params.id)
      .single()

    if (error || !cls) return res.status(404).json({ error: 'Class not found' })

    if (req.userId !== cls.teacher_id && !(await isAdmin(req.userId))) {
      return res.status(403).json({ error: 'Only the teacher who created this class (or an admin) can cancel it' })
    }

    if (cls.status !== 'cancelled') {
      const { data: sessions } = await supabase
        .from('class_sessions')
        .select('id, session_date, status')
        .eq('class_id', cls.id)

      if (!hasFutureSession(sessions)) {
        return res.status(400).json({ error: 'This class has already happened and cannot be cancelled' })
      }
    }

    const result = await cancelClass(cls.id, cls)
    res.json({ success: true, ...result })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not cancel class' })
  }
})

module.exports = router
