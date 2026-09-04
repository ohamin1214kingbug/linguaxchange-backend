const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { getEarnedBadges } = require('../utils/badges')
const { publicGetLimiter } = require('../middleware/rateLimit')
const { isImplicitAutoSync } = require('../utils/timezonePolicy')
const { checkAndNotifyIfAlreadyLow } = require('../utils/lowCreditNudge')
const { isValidClassSize, CLASS_SIZE_ERROR } = require('../utils/classSize')
const { fail } = require('../utils/failure')
const { decodeImage } = require('../utils/imageUpload')
const { parseUserQuery, MAX_RESULTS } = require('../utils/userSearch')

// Everything the profile screen needs. PUBLIC_FIELDS omits email; the
// owner-only responses add it. notification_preferences and the teaching
// defaults are owner-only too — no one else needs to see your settings.
const PUBLIC_FIELDS = 'id, first_name, last_name, nationality, bio, photo_url, teach_language, teach_level, learn_languages, has_certificate, certificate_explanation, is_approved, current_streak, longest_streak, timezone, timezone_source, time_format, university_domain, university_verified_at'
const USER_FIELDS = 'id, email, first_name, last_name, nationality, bio, photo_url, teach_language, teach_level, learn_languages, has_certificate, certificate_explanation, is_approved, current_streak, longest_streak, timezone, timezone_source, time_format, notification_preferences, default_class_duration_minutes, default_max_students, university_domain, university_verified_at'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// GET /api/users/:id
// GET /api/users/search?q= — find one person by name or by their code.
//
// Declared above /:id, which would otherwise swallow "search" as an id.
//
// Signed-in only, unlike the profile it links to. The profiles themselves
// are already public, so this exposes no new kind of data — what it changes
// is enumeration: with an id you look up one person, with a name you could
// harvest the list. Behind an account, that stays costly and attributable
// to someone who can be suspended.
//
// Returns what a result row needs and nothing more. The code is included
// because finding someone by name is how you get the code you then paste
// into a report.
const SEARCH_FIELDS = 'id, first_name, last_name, photo_url, nationality, teach_language, teach_level'

router.get('/search', requireAuth, publicGetLimiter, async (req, res) => {
  const parsed = parseUserQuery(req.query.q)
  if (!parsed.ok) return res.status(400).json({ error: parsed.error })

  try {
    let query = supabase.from('users').select(SEARCH_FIELDS).is('deleted_at', null)

    if (parsed.id) {
      query = query.eq('id', parsed.id)
    } else {
      // One .or() per word, and PostgREST ANDs separate filters — so
      // "Hamin Oh" becomes (first~Hamin or last~Hamin) AND (first~Oh or
      // last~Oh), which is what makes a full name match a split column.
      for (const term of parsed.terms) {
        query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
      }
    }

    const { data, error } = await query.limit(MAX_RESULTS)
    if (error) return fail(res, 400, 'Could not search', error)

    res.json(data || [])
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not search' })
  }
})

router.get('/:id', publicGetLimiter, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select(PUBLIC_FIELDS + ', deleted_at')
      .eq('id', req.params.id)
      .single()

    // A deleted account is gone as far as the public is concerned — the row
    // only survives to keep other members' class history intact, so serving
    // it here would leave an anonymized ghost profile in the directory and
    // in teacher search.
    if (error || data?.deleted_at) return res.status(404).json({ error: 'User not found' })

    const { deleted_at, ...publicProfile } = data
    const badges = await getEarnedBadges(req.params.id)
    res.json({ ...publicProfile, badges })
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch user' })
  }
})

const MAX_AVATAR_BYTES = 5 * 1024 * 1024

// POST /api/users/:id/avatar
// Uploads through the service-role key instead of the frontend hitting
// Supabase Storage directly, so the storage.objects policies don't need to
// stay open to the public anon key just for logged-in users to upload.
router.post('/:id/avatar', requireAuth, async (req, res) => {
  if (req.userId !== parseInt(req.params.id)) {
    return res.status(403).json({ error: 'You can only edit your own profile' })
  }

  // Shared decoder: it checks the magic bytes, not just the declared type.
  // This path used to trust the content type in the data URL, which meant
  // anything at all could be stored under a .png in a public bucket.
  const decoded = decodeImage(req.body.image, { maxBytes: MAX_AVATAR_BYTES })
  if (!decoded.ok) return res.status(400).json({ error: decoded.error })

  const path = `avatars/${req.userId}.${decoded.ext}`

  try {
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, decoded.buffer, { contentType: decoded.mime, upsert: true })
    if (uploadError) return fail(res, 400, 'Could not upload avatar', uploadError)

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)

    const { data, error } = await supabase
      .from('users')
      .update({ photo_url: publicUrl })
      .eq('id', req.userId)
      .select(USER_FIELDS)
      .single()

    if (error) return fail(res, 400, 'Could not upload avatar', error)
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
  const allowed = ['bio', 'nationality', 'photo_url', 'teach_language', 'teach_level', 'learn_languages', 'has_certificate', 'certificate_explanation', 'first_name', 'last_name', 'timezone', 'timezone_source', 'time_format', 'notification_preferences', 'default_class_duration_minutes', 'default_max_students']
  const updates = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  // Null clears the default, which is allowed; any other value has to be a
  // size a class could actually be created with, or the database's CHECK
  // would reject it with a raw constraint string.
  if (updates.default_max_students != null && !isValidClassSize(updates.default_max_students)) {
    return res.status(400).json({ error: CLASS_SIZE_ERROR })
  }

  try {
    // Once someone has deliberately picked a zone, the login-time
    // auto-detect sync must not silently overwrite it. Guarded here rather
    // than in the caller so it holds for any client, not just the one that
    // remembers to check. See utils/timezonePolicy.js for why this keys off
    // "no timezone_source sent" rather than "source isn't manual".
    if (isImplicitAutoSync(updates)) {
      const { data: current } = await supabase
        .from('users')
        .select('timezone_source')
        .eq('id', req.params.id)
        .single()
      if (current?.timezone_source === 'manual') delete updates.timezone
    }

    // A suppressed auto-sync can empty this out. An empty .update() errors,
    // so return the row unchanged instead — nothing to write is a success,
    // not a failure.
    if (Object.keys(updates).length === 0) {
      const { data } = await supabase
        .from('users')
        .select(USER_FIELDS)
        .eq('id', req.params.id)
        .single()
      return res.json(data)
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.params.id)
      .select(USER_FIELDS)
      .single()

    if (error) return fail(res, 400, 'Could not update user', error)
    res.json(data)

    // Fire-and-forget, after the response: someone re-enabling the nudge
    // while already low shouldn't wait on their next credit spend to hear
    // about it. Not gated on "was it previously off" — checkAndNotifyIfAlreadyLow
    // is idempotent per low-balance episode, so a redundant call is a no-op.
    if (updates.notification_preferences?.low_credit_nudge === true) {
      checkAndNotifyIfAlreadyLow(req.params.id)
    }
  } catch (e) {
    res.status(500).json({ error: 'Could not update user' })
  }
})

module.exports = router
