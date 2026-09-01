const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { isValidRating } = require('../utils/reviewValidation')
const { fail } = require('../utils/failure')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// POST /api/reviews
router.post('/', requireAuth, async (req, res) => {
  const { class_session_id, rating, comment } = req.body
  const sessionId = parseInt(class_session_id)
  const ratingNum = parseInt(rating)

  if (!isValidRating(ratingNum)) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' })
  }

  try {
    // Only someone who actually attended this session can review it
    const { data: attendance } = await supabase
      .from('class_enrollments')
      .select('id')
      .eq('class_session_id', sessionId)
      .eq('user_id', req.userId)
      .eq('attended', true)
      .maybeSingle()

    if (!attendance) {
      return res.status(403).json({ error: 'You can only review a class you attended' })
    }

    const { data: existingReview } = await supabase
      .from('class_reviews')
      .select('id')
      .eq('class_session_id', sessionId)
      .eq('student_id', req.userId)
      .maybeSingle()

    if (existingReview) {
      return res.status(400).json({ error: 'You already reviewed this class' })
    }

    const { data, error } = await supabase
      .from('class_reviews')
      .insert([{
        class_session_id: sessionId,
        student_id: req.userId,
        rating: ratingNum,
        comment
      }])
      .select()
      .single()

    if (error) return fail(res, 400, 'Could not submit review', error)
    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not submit review' })
  }
})

// GET /api/reviews/mine — sessions this user has already reviewed.
//
// Without this the dashboard has no way to know a review exists, so it kept
// offering an empty "Rate this class" form after a successful submit; the
// second attempt then hit the "You already reviewed this class" branch above.
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('class_reviews')
      .select('class_session_id, rating, comment')
      .eq('student_id', req.userId)

    if (error) return fail(res, 400, 'Could not fetch your reviews', error)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch your reviews' })
  }
})

// GET /api/reviews/teacher/:teacherId
router.get('/teacher/:teacherId', async (req, res) => {
  try {
    const { data: sessions, error: sessionError } = await supabase
      .from('class_sessions')
      .select('id, classes!inner(teacher_id)')
      .eq('classes.teacher_id', req.params.teacherId)

    if (sessionError) return fail(res, 400, 'Could not fetch reviews', sessionError)

    const sessionIds = sessions.map(s => s.id)
    if (sessionIds.length === 0) return res.json([])

    const { data, error } = await supabase
      .from('class_reviews')
      .select('rating, comment, created_at')
      .in('class_session_id', sessionIds)
      .order('created_at', { ascending: false })

    if (error) return fail(res, 400, 'Could not fetch reviews', error)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch reviews' })
  }
})

module.exports = router