const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { cleanAnswers, isComplete } = require('../utils/survey')
const { grantSurveyBanana } = require('../utils/surveyBanana')
const { fail } = require('../utils/failure')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// GET /api/survey/me — this member's answers so far ({} when none).
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('survey_responses')
      .select('heard_from, heard_detail, who, who_detail, goals, times, ideas, completed_at, banana_granted_at')
      .eq('user_id', req.userId).maybeSingle()
    if (error) return fail(res, 400, 'Could not load the survey', error)
    res.json(data || {})
  } catch (e) {
    fail(res, 500, 'Could not load the survey', e)
  }
})

// PUT /api/survey/me — saves answers as the member goes; { complete: true }
// on the last screen finishes it and pays the banana (once). A finished
// survey can't be changed.
router.put('/me', requireAuth, async (req, res) => {
  try {
    const { data: existing } = await supabase.from('survey_responses').select('*').eq('user_id', req.userId).maybeSingle()
    if (existing?.completed_at) return res.json({ completed: true, banana: existing.banana_granted_at ? 'granted' : 'pending' })
    const answers = cleanAnswers(req.body)
    const merged = { ...(existing || {}), ...answers }
    const finishing = req.body?.complete === true
    if (finishing && !isComplete(merged)) return res.status(400).json({ error: 'Answer questions 1 to 4 first' })
    const now = new Date().toISOString()
    const { error } = await supabase.from('survey_responses')
      .upsert({ user_id: req.userId, ...answers, updated_at: now, ...(finishing ? { completed_at: now } : {}) }, { onConflict: 'user_id' })
    if (error) return fail(res, 400, 'Could not save your answers', error)
    if (!finishing) return res.json({ completed: false })
    res.json({ completed: true, banana: await grantSurveyBanana(req.userId) })
  } catch (e) {
    fail(res, 500, 'Could not save your answers', e)
  }
})

module.exports = router
