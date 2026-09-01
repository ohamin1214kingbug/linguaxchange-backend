const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth, requireAdmin, isAdmin } = require('../middleware/auth')
const { sendEmail } = require('../utils/mailer')
const { buildSessionDates } = require('../utils/sessionDates')
const { hasFutureSession, cancelClass } = require('../utils/classCancellation')
const { sortBySoonest } = require('../utils/classSearch')
const { initialClassStatus, getTeacherIsApproved } = require('../utils/classApproval')
const { publicGetLimiter } = require('../middleware/rateLimit')
const { isValidClassSize, CLASS_SIZE_ERROR } = require('../utils/classSize')
const { decodePdf } = require('../utils/pdfUpload')
const { fail } = require('../utils/failure')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const CLASS_MATERIALS_BUCKET = 'class-materials'

// GET /api/classes — all filters compose (AND together). q does a simple
// case-insensitive substring match on title/description; full-text-search
// infra would be overkill at this scale. Default (and only) sort is
// soonest-upcoming-session-first, computed in utils/classSearch.js since
// PostgREST can't order a parent query by a child table's aggregate.
router.get('/', publicGetLimiter, async (req, res) => {
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
    if (error) return fail(res, 400, 'Could not fetch classes', error)
    res.json(sortBySoonest(data || []))
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch classes' })
  }
})

// GET /api/classes/:id — one class, for its own detail page. Public, and
// deliberately carries no student identities; the roster is a separate
// authenticated route below.
router.get('/:id', publicGetLimiter, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('classes')
      .select('*, teacher:users!teacher_id(id, first_name, last_name, photo_url), class_sessions(id, session_date, zoom_meeting_link, status)')
      .eq('id', req.params.id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Class not found' })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch class' })
  }
})

// GET /api/classes/:id/roster — who actually joined, per session. Teacher
// (or admin) only: this is the one place student names attach to a class,
// so it stays off the public detail route above.
//
// Enrollments hang off class_sessions, not classes, so a recurring class
// has a separate roster per occurrence — returned grouped that way rather
// than flattened, which would double-count a student who joined twice.
router.get('/:id/roster', requireAuth, async (req, res) => {
  try {
    const { data: cls, error } = await supabase
      .from('classes')
      .select('id, teacher_id, max_students')
      .eq('id', req.params.id)
      .single()

    if (error || !cls) return res.status(404).json({ error: 'Class not found' })
    if (req.userId !== cls.teacher_id && !(await isAdmin(req.userId))) {
      return res.status(403).json({ error: 'Only the teacher who created this class (or an admin) can see who joined' })
    }

    const { data: sessions } = await supabase
      .from('class_sessions')
      .select('id, session_date, status')
      .eq('class_id', cls.id)
      .order('session_date', { ascending: true })

    const sessionIds = (sessions || []).map(s => s.id)
    const { data: enrollments } = sessionIds.length
      ? await supabase
          .from('class_enrollments')
          .select('class_session_id, status, attended, student:users!user_id(id, first_name, last_name, photo_url)')
          .in('class_session_id', sessionIds)
      : { data: [] }

    res.json({
      max_students: cls.max_students,
      sessions: (sessions || []).map(s => ({
        ...s,
        students: (enrollments || [])
          .filter(e => e.class_session_id === s.id)
          .map(e => ({ ...e.student, status: e.status, attended: e.attended }))
      }))
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not fetch roster' })
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
    return res.status(400).json({ error: 'A valid scheduled_at is required', field: 'scheduled_at' })
  }
  if (new Date(scheduled_at).getTime() <= Date.now()) {
    return res.status(400).json({ error: 'This time has already passed. Please pick a future time.', field: 'scheduled_at' })
  }
  // Bounded, not just positive: without the ceiling this passed anything
  // over 1 straight through to the database's CHECK constraint, which came
  // back to the teacher as a raw "violates check constraint" string.
  if (!isValidClassSize(max_students)) {
    return res.status(400).json({ error: CLASS_SIZE_ERROR })
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
    const teacherIsApproved = await getTeacherIsApproved(req.userId)

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
        status: initialClassStatus(teacherIsApproved)
      }])
      .select()
      .single()

    if (error) {
      return fail(res, 400, 'Could not create the class', error)
    }

    // A recurring series is anchored to the teacher's timezone, so a 19:00
    // class stays 19:00 for the people attending it after the clocks change.
    // Only fetched on the recurring path — a single class has nothing to step,
    // so it shouldn't pay for the round trip. A null timezone falls back to
    // UTC inside buildSessionDates.
    let teacherTimeZone = null
    if (format === 'recurring') {
      const { data: teacher } = await supabase
        .from('users')
        .select('timezone')
        .eq('id', req.userId)
        .single()
      teacherTimeZone = teacher?.timezone || null
    }

    const sessionDates = format === 'recurring'
      ? buildSessionDates(scheduled_at, recurrence_type, recurrence_end_date, teacherTimeZone)
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
      return fail(res, 400, 'Could not schedule the class sessions', sessionError)
    }

    res.status(201).json({ ...cls, sessionCount: sessionDates.length })
  } catch (e) {
    console.log('CATCH ERROR:', e.message)
    fail(res, 500, 'Could not approve class', e)
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
    if (error) return fail(res, 400, 'Could not approve class', error)

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
    if (error) return fail(res, 400, 'Could not reject class', error)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not reject class' })
  }
})

// Who may change a class: its own teacher (or an admin), and only while the
// class isn't cancelled. Shared by PATCH and the materials upload below so a
// change to the rule can't apply to one and miss the other.
//
// requireFuture gates the extra "and it hasn't happened yet" rule, which
// applies to what the class *is* — title, description — because rewriting
// those after the fact misrepresents something students already attended.
// Materials are deliberately exempt: handing out a recap, homework, or a
// corrected worksheet after the session is normal teaching, not rewriting
// history.
async function editableClassOr(classId, userId, { requireFuture = true } = {}) {
  const { data: cls, error } = await supabase
    .from('classes')
    .select('id, teacher_id, status')
    .eq('id', classId)
    .single()

  if (error || !cls) return { status: 404, error: 'Class not found' }
  if (userId !== cls.teacher_id && !(await isAdmin(userId))) {
    return { status: 403, error: 'Only the teacher who created this class (or an admin) can edit it' }
  }
  if (cls.status === 'cancelled') {
    return { status: 400, error: 'This class has been cancelled and cannot be edited' }
  }

  if (requireFuture) {
    const { data: sessions } = await supabase
      .from('class_sessions')
      .select('id, session_date, status')
      .eq('class_id', cls.id)

    if (!hasFutureSession(sessions)) {
      return { status: 400, error: 'This class has already happened and cannot be edited' }
    }
  }
  return { cls }
}

// PATCH /api/classes/:id — title/description only. Time changes aren't
// supported here: with bookings possible and classes.status not having a
// per-time-slot concept once a class is recurring, the safer v1 answer is
// to force cancel + repost instead of allowing a time edit that could
// silently pull the rug out from under someone who already booked a slot.
router.patch('/:id', requireAuth, async (req, res) => {
  const { title, description, materials } = req.body
  try {
    // Only title/description carry the "not yet happened" rule; a
    // materials-only edit stays open after the session.
    const rewritesTheClass = title !== undefined || description !== undefined
    const gate = await editableClassOr(req.params.id, req.userId, { requireFuture: rewritesTheClass })
    if (gate.error) return res.status(gate.status).json({ error: gate.error })
    const cls = gate.cls

    const updates = {}
    if (title !== undefined) updates.title = title
    if (description !== undefined) updates.description = description
    // Empty string means "cleared", which is a real choice — store NULL for
    // it rather than an empty string so "no materials" is one state, not two.
    if (materials !== undefined) updates.materials = materials || null

    const { data: updated, error: updateError } = await supabase
      .from('classes')
      .update(updates)
      .eq('id', cls.id)
      .select()
      .single()

    if (updateError) return fail(res, 400, 'Could not update class', updateError)
    res.json(updated)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not update class' })
  }
})

// POST /api/classes/:id/materials-pdf — replaces the class's materials PDF,
// or removes it when sent { pdf: null }.
//
// Base64 in a JSON body, mirroring the avatar upload in routes/users.js, so
// the browser never needs the anon key and storage policies can stay shut.
// The bucket independently enforces PDF-only and a 10MB ceiling, but both
// are re-checked here so a bad request fails with a useful message rather
// than a storage error.
router.post('/:id/materials-pdf', requireAuth, async (req, res) => {
  try {
    const gate = await editableClassOr(req.params.id, req.userId, { requireFuture: false })
    if (gate.error) return res.status(gate.status).json({ error: gate.error })
    const cls = gate.cls

    const path = `class-${cls.id}.pdf`

    // Explicit null clears it. Undefined would be an accident; only an
    // outright null counts as "remove this".
    if (req.body.pdf === null) {
      await supabase.storage.from(CLASS_MATERIALS_BUCKET).remove([path])
      const { data, error } = await supabase
        .from('classes')
        .update({ lesson_plan_url: null })
        .eq('id', cls.id)
        .select()
        .single()
      if (error) return fail(res, 400, 'Could not upload the PDF', error)
      return res.json(data)
    }

    const decoded = decodePdf(req.body.pdf)
    if (!decoded.ok) return res.status(400).json({ error: decoded.error })
    const buffer = decoded.buffer

    const { error: uploadError } = await supabase.storage
      .from(CLASS_MATERIALS_BUCKET)
      .upload(path, buffer, { contentType: 'application/pdf', upsert: true })
    if (uploadError) return fail(res, 400, 'Could not upload the PDF', uploadError)

    const { data: { publicUrl } } = supabase.storage
      .from(CLASS_MATERIALS_BUCKET)
      .getPublicUrl(path)

    // Cache-bust: the path is stable across re-uploads, so without this a
    // replaced PDF would keep serving the old cached copy.
    const versioned = `${publicUrl}?v=${Date.now()}`

    const { data, error } = await supabase
      .from('classes')
      .update({ lesson_plan_url: versioned })
      .eq('id', cls.id)
      .select()
      .single()

    if (error) return fail(res, 400, 'Could not upload the PDF', error)
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not upload the PDF' })
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
