const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// GET /api/saved-teachers — mine, with the teacher's public info joined.
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('saved_teachers')
      // nationality and bio are already public on GET /api/users/:id, so
      // joining them here exposes nothing new — it just saves opening each
      // teacher's page to remember which one you saved.
      .select('created_at, teacher:users!teacher_id(id, first_name, last_name, photo_url, teach_language, teach_level, nationality, bio)')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json((data || []).map(row => row.teacher).filter(Boolean))
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch saved teachers' })
  }
})

// POST /api/saved-teachers — save one, found by id (derived from their code
// client-side). Only teachers can be saved — the whole point of the list.
router.post('/', requireAuth, async (req, res) => {
  const teacherId = parseInt(req.body.teacher_id)
  if (!teacherId) return res.status(400).json({ error: 'teacher_id is required' })
  if (teacherId === req.userId) return res.status(400).json({ error: 'You cannot save yourself' })

  try {
    const { data: target } = await supabase
      .from('users')
      .select('id, teach_language')
      .eq('id', teacherId)
      .single()

    if (!target) return res.status(404).json({ error: 'No user found with that code' })
    if (!target.teach_language) return res.status(400).json({ error: 'That user does not teach classes' })

    const { error } = await supabase
      .from('saved_teachers')
      .upsert([{ user_id: req.userId, teacher_id: teacherId }], { onConflict: 'user_id,teacher_id' })

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not save teacher' })
  }
})

// DELETE /api/saved-teachers/:teacherId
router.delete('/:teacherId', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('saved_teachers')
      .delete()
      .eq('user_id', req.userId)
      .eq('teacher_id', req.params.teacherId)

    if (error) return res.status(400).json({ error: error.message })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not unsave teacher' })
  }
})

module.exports = router
