const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { SKILLS, validateFeedback } = require('../utils/studentFeedback')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Resolves the session and confirms the caller teaches it. Returns null when
// the session doesn't exist or belongs to someone else, so callers can 403
// without duplicating the lookup.
async function getOwnedSession(sessionId, userId) {
  const { data: session } = await supabase
    .from('class_sessions')
    .select('id, session_date, classes(id, title, teacher_id)')
    .eq('id', sessionId)
    .single()

  if (!session || session.classes?.teacher_id !== userId) return null
  return session
}

// GET /api/student-feedback/session/:sessionId — the roster the teacher rates,
// with whatever they've already submitted merged in.
router.get('/session/:sessionId', requireAuth, async (req, res) => {
  try {
    const session = await getOwnedSession(req.params.sessionId, req.userId)
    if (!session) return res.status(403).json({ error: 'You do not teach this class' })

    const { data: enrollments } = await supabase
      .from('class_enrollments')
      .select('user_id, attended, users(id, first_name, last_name, photo_url)')
      .eq('class_session_id', session.id)

    const { data: existing } = await supabase
      .from('student_feedback')
      .select('*')
      .eq('class_session_id', session.id)

    const byStudent = new Map((existing || []).map(f => [f.student_id, f]))

    res.json((enrollments || []).filter(e => e.users).map(e => ({
      student: e.users,
      attended: e.attended,
      feedback: byStudent.get(e.user_id) || null
    })))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not load students' })
  }
})

// POST /api/student-feedback — create or overwrite one student's feedback.
router.post('/', requireAuth, async (req, res) => {
  const sessionId = parseInt(req.body.class_session_id)
  const studentId = parseInt(req.body.student_id)
  if (!sessionId || !studentId) {
    return res.status(400).json({ error: 'class_session_id and student_id are required' })
  }

  const check = validateFeedback(req.body)
  if (!check.ok) return res.status(400).json({ error: check.error })

  try {
    const session = await getOwnedSession(sessionId, req.userId)
    if (!session) return res.status(403).json({ error: 'You do not teach this class' })

    // Rating someone who was never in the room would be meaningless, and
    // would also let a teacher write to an arbitrary user's history.
    const { data: enrollment } = await supabase
      .from('class_enrollments')
      .select('id')
      .eq('class_session_id', sessionId)
      .eq('user_id', studentId)
      .maybeSingle()

    if (!enrollment) return res.status(400).json({ error: 'That student was not in this class' })

    const { data, error } = await supabase
      .from('student_feedback')
      .upsert([{
        class_session_id: sessionId,
        student_id: studentId,
        teacher_id: req.userId,
        ...check.skills,
        comment: check.comment,
        updated_at: new Date().toISOString()
      }], { onConflict: 'class_session_id,student_id' })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not save feedback' })
  }
})

// GET /api/student-feedback/mine — what the caller has received, newest first.
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('student_feedback')
      .select('*, teacher:users!teacher_id(first_name, last_name)')
      .eq('student_id', req.userId)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not load feedback' })
  }
})

module.exports = router
