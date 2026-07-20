const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// POST /api/reviews
router.post('/', requireAuth, async (req, res) => {
  const { class_session_id, rating, comment } = req.body
  try {
    const { data, error } = await supabase
      .from('class_reviews')
      .insert([{
        class_session_id: parseInt(class_session_id),
        student_id: req.userId,
        rating: parseInt(rating),
        comment
      }])
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not submit review' })
  }
})

// GET /api/reviews/teacher/:teacherId
router.get('/teacher/:teacherId', async (req, res) => {
  try {
    const { data: sessions, error: sessionError } = await supabase
      .from('class_sessions')
      .select('id, classes!inner(teacher_id)')
      .eq('classes.teacher_id', req.params.teacherId)

    if (sessionError) return res.status(400).json({ error: sessionError.message })

    const sessionIds = sessions.map(s => s.id)
    if (sessionIds.length === 0) return res.json([])

    const { data, error } = await supabase
      .from('class_reviews')
      .select('rating, comment, created_at')
      .in('class_session_id', sessionIds)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch reviews' })
  }
})

module.exports = router