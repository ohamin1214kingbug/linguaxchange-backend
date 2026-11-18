// The survey's one bonus banana. Claimed by stamping banana_granted_at
// only where it is still empty, so two requests at once can't both pay.
// A member without a banana account yet (phone not verified) gets it when
// they verify: routes/auth.js /add-phone calls this again.
const { createClient } = require('@supabase/supabase-js')
const { grantBonus } = require('./referrals')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

async function grantSurveyBanana(userId) {
  const { data: claimed } = await supabase.from('survey_responses')
    .update({ banana_granted_at: new Date().toISOString() })
    .eq('user_id', userId).not('completed_at', 'is', null).is('banana_granted_at', null)
    .select('user_id')
  if (!claimed?.length) return 'none'
  if (await grantBonus(userId, 'Thanks for answering the survey')) return 'granted'
  // No banana account yet: release the claim so phone verification pays it.
  await supabase.from('survey_responses').update({ banana_granted_at: null }).eq('user_id', userId)
  return 'pending'
}

module.exports = { grantSurveyBanana }
