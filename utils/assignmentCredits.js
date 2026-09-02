const { createClient } = require('@supabase/supabase-js')

let client
function db() {
  if (!client) client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  return client
}

// Its own transaction type, not 'earned'. Two consequences, both deliberate:
// the cap below is an exact count of typed rows rather than a string match on
// a description, and creditSpendGate.hasEverTaught keeps counting only
// 'earned' — so reviewing paragraphs does not exempt anyone from the
// anti-freeloading gate. Reusing 'earned' would have granted that exemption
// by accident.
const FEEDBACK_TYPE = 'earned_feedback'

// One banana buys a 60-minute class or roughly ten minutes of annotation.
// Uncapped, reviewing is strictly better than teaching and the rational
// response is to stop offering classes — which is the part universities
// actually want. Three is a guess; revisit once there is data on whether the
// two actually compete.
const WEEKLY_FEEDBACK_CAP = 3
const WINDOW_DAYS = 7

function isOverCap(countInWindow) {
  return countInWindow >= WEEKLY_FEEDBACK_CAP
}

function windowStart(now = new Date()) {
  return new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
}

// Fails closed: a lookup error refuses the earning rather than granting it,
// because the failure mode of the opposite is an uncapped currency.
async function countFeedbackEarnings(userId, since = windowStart()) {
  const { count, error } = await db()
    .from('credit_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('type', FEEDBACK_TYPE)
    .gte('created_at', since.toISOString())

  if (error) {
    console.error('feedback cap lookup failed', error)
    return WEEKLY_FEEDBACK_CAP
  }
  return count || 0
}

// Atomic add through the same RPC every other credit path uses. Never
// read-modify-write.
async function releaseFeedbackCredit(reviewerId) {
  const { data: balanceAfter, error } = await db()
    .rpc('add_credit', { p_user_id: reviewerId, p_amount: 1 })
  if (error || balanceAfter === null) {
    console.error('feedback credit release failed', error)
    return { ok: false }
  }

  await db().from('credit_transactions').insert([{
    user_id: reviewerId,
    amount: 1,
    type: FEEDBACK_TYPE,
    description: 'Assignment feedback',
  }])

  return { ok: true, balance: balanceAfter }
}

module.exports = {
  isOverCap, countFeedbackEarnings, releaseFeedbackCredit, windowStart,
  WEEKLY_FEEDBACK_CAP, FEEDBACK_TYPE, WINDOW_DAYS,
}
