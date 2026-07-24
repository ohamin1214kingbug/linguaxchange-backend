const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, nationality, bio, photo_url, teach_language, teach_level, learn_languages, has_certificate, certificate_explanation, is_approved, current_streak, longest_streak')
      .eq('id', req.params.id)
      .single()

    if (error) return res.status(404).json({ error: 'User not found' })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch user' })
  }
})

// PATCH /api/users/:id
router.patch('/:id', requireAuth, async (req, res) => {
  if (req.userId !== parseInt(req.params.id)) {
    return res.status(403).json({ error: 'You can only edit your own profile' })
  }
  const allowed = ['bio', 'nationality', 'photo_url', 'teach_language', 'teach_level', 'learn_languages', 'has_certificate', 'certificate_explanation', 'first_name', 'last_name']
  const updates = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.params.id)
      .select('id, email, first_name, last_name, nationality, bio, photo_url, teach_language, teach_level, learn_languages, has_certificate, certificate_explanation, is_approved, current_streak, longest_streak')
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not update user' })
  }
})

module.exports = router
