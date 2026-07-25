const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('./mailer')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const FRONTEND_URL = 'https://linguaxchange-frontend.vercel.app'
const LOW_CREDIT_THRESHOLD = 1

function isLowBalance(balance) {
  return balance <= LOW_CREDIT_THRESHOLD
}

// Pure gate combining the balance threshold with an engagement check.
// `priorTransactionCount` = the user's credit_transactions rows that existed
// BEFORE the spend that triggered this check. Requiring at least 1 excludes
// a brand-new user's very first-ever transaction (their untouched signup
// credit) — this app has no purchase flow, so "purchased before" from the
// spec is adapted to "has real history in the credit economy already."
function shouldConsiderNudge(balance, priorTransactionCount) {
  return isLowBalance(balance) && priorTransactionCount > 0
}

// Fires on the "credit spent" event only (routes/enrollments.js join-class
// flow) — not on admin/refund balance changes, per spec. Sends at most one
// email per low-balance episode: the conditional UPDATE (.is(..., null))
// atomically claims the send, so concurrent requests can't double-send —
// only the request whose UPDATE actually matched a NULL row gets `claimed`
// back non-empty and proceeds to email.
async function maybeSendLowCreditNudge(userId, newBalance) {
  try {
    const { count } = await supabase
      .from('credit_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    const priorTransactionCount = (count || 1) - 1 // exclude the spend that just triggered this check
    if (!shouldConsiderNudge(newBalance, priorTransactionCount)) return

    const { data: claimed, error } = await supabase
      .from('credits')
      .update({ low_credit_notified_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('low_credit_notified_at', null)
      .select()

    if (error || !claimed || claimed.length === 0) return // already notified this episode, or lost the race

    const { data: user } = await supabase
      .from('users')
      .select('email, first_name')
      .eq('id', userId)
      .single()

    if (!user?.email) return

    const whatItsGoodFor = newBalance === 1
      ? 'enough for one more class'
      : "not quite enough to join another class yet — you'll need to earn more first"

    await sendEmail({
      to: user.email,
      subject: `You're down to ${newBalance} credit${newBalance === 1 ? '' : 's'}`,
      text: `Hi ${user.first_name || ''}, you're down to ${newBalance} credit${newBalance === 1 ? '' : 's'} on LinguaXchange — ${whatItsGoodFor}.\n\nTeach a class to earn more credits: ${FRONTEND_URL}/classes/create`
    })
  } catch (e) {
    console.error('[LOW_CREDIT_NUDGE] Failed to notify user', userId, e.message)
  }
}

// Call whenever a user's balance increases (teaching a class, or a student
// confirming attendance credits the teacher). Resets the notified flag once
// they're back above the threshold, so a future dip sends a fresh email —
// this is the "top-up" half of the spec's dedup rule.
async function resetLowCreditNotificationIfToppedUp(userId, newBalance) {
  if (isLowBalance(newBalance)) return
  try {
    await supabase
      .from('credits')
      .update({ low_credit_notified_at: null })
      .eq('user_id', userId)
  } catch (e) {
    console.error('[LOW_CREDIT_NUDGE] Could not reset notified flag for user', userId, e.message)
  }
}

module.exports = {
  LOW_CREDIT_THRESHOLD,
  isLowBalance,
  shouldConsiderNudge,
  maybeSendLowCreditNudge,
  resetLowCreditNotificationIfToppedUp
}
