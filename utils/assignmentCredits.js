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
//
// The add_credit payout and the credit_transactions row are two separate
// writes with no shared transaction, so they can diverge. If the insert
// fails silently after a successful payout, countFeedbackEarnings — which
// counts exactly these rows — never sees it: an uncapped currency, paid out
// for free forever. (This is FINDING 1 from the task-4 review: the column
// that made every 'earned_feedback' insert fail has since been widened, see
// migrations/add_assignment_feedback.sql, but the code must not trust the
// insert regardless.)
//
// So the insert's error is checked, and on failure the payout is reversed
// via spend_credit — the only other atomic credit RPC available — rather
// than left standing with no audit row. spend_credit only decrements when
// the balance can cover it, so if the caller has already spent the credit
// elsewhere in the interim the reversal itself fails; that case is logged
// as its own error (balance and audit log are now genuinely out of sync)
// since there's no further atomic recovery available. Either way the caller
// gets { ok: false } — a payout that couldn't be recorded is never reported
// as a success.
async function releaseFeedbackCredit(reviewerId) {
  const { data: balanceAfter, error } = await db()
    .rpc('add_credit', { p_user_id: reviewerId, p_amount: 1 })
  if (error || balanceAfter === null) {
    console.error('feedback credit release failed', error)
    return { ok: false }
  }

  const { error: insertError } = await db().from('credit_transactions').insert([{
    user_id: reviewerId,
    amount: 1,
    type: FEEDBACK_TYPE,
    description: 'Assignment feedback',
  }])

  if (insertError) {
    console.error('feedback credit transaction insert failed, reversing payout', insertError)

    const { data: balanceAfterReversal, error: reversalError } = await db()
      .rpc('spend_credit', { p_user_id: reviewerId, p_amount: 1 })
    if (reversalError || balanceAfterReversal === null) {
      console.error(
        'feedback credit reversal failed — balance and audit log are now out of sync for user',
        reviewerId, reversalError
      )
    }

    return { ok: false }
  }

  return { ok: true, balance: balanceAfter }
}

module.exports = {
  isOverCap, countFeedbackEarnings, releaseFeedbackCredit, windowStart,
  WEEKLY_FEEDBACK_CAP, FEEDBACK_TYPE, WINDOW_DAYS,
}
