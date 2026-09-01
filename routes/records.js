const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { publicGetLimiter } = require('../middleware/rateLimit')
const { summarise } = require('../utils/participation')
const { fail } = require('../utils/failure')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// POST /api/records/share — create the link, or rotate it.
//
// Rotating is the revoke: a new token invalidates every link already shared,
// which is the only control a member has once a URL has left their hands.
router.post('/share', requireAuth, async (req, res) => {
  try {
    const token = crypto.randomBytes(32).toString('hex')
    const { error } = await supabase
      .from('users')
      .update({ record_token: token })
      .eq('id', req.userId)
    if (error) return fail(res, 400, 'Could not create the link', error)
    res.json({ token })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not create the link' })
  }
})

// GET /api/records/share — the caller's own token, if they have one.
//
// Without this the settings page cannot tell an existing link from no link,
// so it labels the button "Create" either way — and pressing it rotates the
// URL someone already handed to a university office. Authed and scoped to the
// caller: the token is a credential and never appears on a public route.
//
// Declared BEFORE GET /:token or that route would swallow the path and treat
// "share" as somebody's token.
router.get('/share', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('record_token')
      .eq('id', req.userId)
      .maybeSingle()
    if (error) return fail(res, 400, 'Could not read the link', error)
    res.json({ token: data?.record_token || null })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not read the link' })
  }
})

router.delete('/share', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('users')
      .update({ record_token: null })
      .eq('id', req.userId)
    if (error) return fail(res, 400, 'Could not revoke the link', error)
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not revoke the link' })
  }
})

// GET /api/records/:token — the record itself.
//
// Unauthenticated on purpose: the point is handing this to a university office
// that has no account. The token is the credential, so it is 32 random bytes,
// and a wrong one is a flat 404 with no hint that some other token would work.
router.get('/:token', publicGetLimiter, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, first_name, last_name, university_domain, university_verified_at')
      .eq('record_token', req.params.token)
      .maybeSingle()

    if (!user) return res.status(404).json({ error: 'Record not found' })

    // Attended: exactly what the confirm-attendance flow sets. Not "joined" —
    // joining proves nothing happened.
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('attended, class_sessions(session_date, classes(language_code, level, duration_minutes))')
      .eq('student_id', user.id)
      .eq('attended', true)

    // Taught: the teacher's own sessions that have already finished. Not
    // classes.status = 'completed' — that needs a manual admin action almost
    // nothing triggers, so a record built on it would under-count everyone.
    const { data: taughtClasses } = await supabase
      .from('classes')
      .select('language_code, level, duration_minutes, class_sessions(session_date, status)')
      .eq('teacher_id', user.id)

    const now = Date.now()

    const attended = (enrollments || []).map(e => ({
      language_code: e.class_sessions?.classes?.language_code,
      level: e.class_sessions?.classes?.level,
      duration_minutes: e.class_sessions?.classes?.duration_minutes,
      date: e.class_sessions?.session_date,
    }))

    const taught = (taughtClasses || []).flatMap(c =>
      (c.class_sessions || [])
        .filter(s => s.status !== 'cancelled' && new Date(s.session_date).getTime() < now)
        .map(s => ({
          language_code: c.language_code,
          level: c.level,
          duration_minutes: c.duration_minutes,
          date: s.session_date,
        }))
    )

    let university = null
    if (user.university_domain) {
      const { data: uni } = await supabase
        .from('university_domains')
        .select('name')
        .eq('domain', user.university_domain)
        .maybeSingle()
      university = uni?.name || user.university_domain
    }

    res.json({
      // The member chose to share this, and the full name is what makes it
      // usable on a CV. The email address is never included.
      name: `${user.first_name} ${user.last_name}`.trim(),
      university,
      verifiedAt: user.university_verified_at,
      generatedAt: new Date().toISOString(),
      ...summarise({ attended, taught }),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not load the record' })
  }
})

module.exports = router
