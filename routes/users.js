const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { getEarnedBadges } = require('../utils/badges')
const { publicGetLimiter } = require('../middleware/rateLimit')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// GET /api/users/:id
router.get('/:id', publicGetLimiter, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, first_name, last_name, nationality, bio, photo_url, teach_language, teach_level, learn_languages, has_certificate, certificate_explanation, is_approved, current_streak, longest_streak, timezone, timezone_source, time_format')
      .eq('id', req.params.id)
      .single()

    if (error) return res.status(404).json({ error: 'User not found' })

    const badges = await getEarnedBadges(req.params.id)
    res.json({ ...data, badges })
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch user' })
  }
})

const AVATAR_MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

// POST /api/users/:id/avatar
// Uploads through the service-role key instead of the frontend hitting
// Supabase Storage directly, so the storage.objects policies don't need to
// stay open to the public anon key just for logged-in users to upload.
router.post('/:id/avatar', requireAuth, async (req, res) => {
  if (req.userId !== parseInt(req.params.id)) {
    return res.status(403).json({ error: 'You can only edit your own profile' })
  }

  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(req.body.image || '')
  if (!match) return res.status(400).json({ error: 'Expected a jpeg, png, or webp image' })

  const [, mime, base64] = match
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length > MAX_AVATAR_BYTES) return res.status(400).json({ error: 'Image must be under 5MB' })

  const path = `avatars/${req.userId}.${AVATAR_MIME_EXT[mime]}`

  try {
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, buffer, { contentType: mime, upsert: true })
    if (uploadError) return res.status(400).json({ error: uploadError.message })

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)

    const { data, error } = await supabase
      .from('users')
      .update({ photo_url: publicUrl })
      .eq('id', req.userId)
      .select('id, email, first_name, last_name, nationality, bio, photo_url, teach_language, teach_level, learn_languages, has_certificate, certificate_explanation, is_approved, current_streak, longest_streak, timezone, timezone_source, time_format')
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not upload avatar' })
  }
})

// PATCH /api/users/:id
router.patch('/:id', requireAuth, async (req, res) => {
  if (req.userId !== parseInt(req.params.id)) {
    return res.status(403).json({ error: 'You can only edit your own profile' })
  }
  const allowed = ['bio', 'nationality', 'photo_url', 'teach_language', 'teach_level', 'learn_languages', 'has_certificate', 'certificate_explanation', 'first_name', 'last_name', 'timezone', 'timezone_source', 'time_format']
  const updates = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  try {
    // syncTimezone() fires on every login and PATCHes a browser-detected
    // zone. Once someone has deliberately picked a zone, that sync must not
    // silently overwrite it — guarded here rather than in the caller so it
    // holds for any client, not just the one that remembers to check.
    if (updates.timezone && updates.timezone_source !== 'manual') {
      const { data: current } = await supabase
        .from('users')
        .select('timezone_source')
        .eq('id', req.params.id)
        .single()
      if (current?.timezone_source === 'manual') delete updates.timezone
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.params.id)
      .select('id, email, first_name, last_name, nationality, bio, photo_url, teach_language, teach_level, learn_languages, has_certificate, certificate_explanation, is_approved, current_streak, longest_streak, timezone, timezone_source, time_format')
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not update user' })
  }
})

module.exports = router
