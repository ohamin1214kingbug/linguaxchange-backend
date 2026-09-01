const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('./mailer')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const { FRONTEND_URL } = require('./frontendUrl')
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

async function priorTransactionCountFor(userId) {
  const { count } = await supabase
    .from('credit_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  return (count || 1) - 1 // exclude the spend/check that triggered this call
}

// Pure. Missing/null preferences (rows from before this column existed, or
// a shape a future key hasn't reached yet) default to enabled — opt-out,
// not opt-in, matching the column's own DEFAULT.
function nudgeEnabledFromPrefs(prefs) {
  return prefs?.low_credit_nudge !== false
}

async function isNudgeEnabled(userId) {
  const { data } = await supabase
    .from('users')
    .select('notification_preferences')
    .eq('id', userId)
    .single()
  return nudgeEnabledFromPrefs(data?.notification_preferences)
}

// Claims and sends. Shared by the credit-spend trigger and the
// toggled-back-on-while-still-low check below — both are just "has this
// low-balance episode already been notified", gated the same way. The
// conditional UPDATE (.is(..., null)) atomically claims the send, so
// concurrent callers can't double-send — only the one whose UPDATE actually
// matched a NULL row gets `claimed` back non-empty and proceeds to email.
async function claimAndSend(userId, balance) {
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

  const whatItsGoodFor = balance === 1
    ? 'enough for one more class'
    : "not quite enough to join another class yet — you'll need to earn more first"

  await sendEmail({
    to: user.email,
    subject: `You're down to ${balance} credit${balance === 1 ? '' : 's'}`,
    text: `Hi ${user.first_name || ''}, you're down to ${balance} credit${balance === 1 ? '' : 's'} on LinguaXchange — ${whatItsGoodFor}.\n\nTeach a class to earn more credits: ${FRONTEND_URL}/classes/create`
  })
}

// Fires on the "credit spent" event only (routes/enrollments.js join-class
// flow) — not on admin/refund balance changes, per spec.
async function maybeSendLowCreditNudge(userId, newBalance) {
  try {
    if (!(await isNudgeEnabled(userId))) return
    const priorTransactionCount = await priorTransactionCountFor(userId)
    if (!shouldConsiderNudge(newBalance, priorTransactionCount)) return
    await claimAndSend(userId, newBalance)
  } catch (e) {
    console.error('[LOW_CREDIT_NUDGE] Failed to notify user', userId, e.message)
  }
}

// Call right after a user flips notification_preferences.low_credit_nudge
// from off to on. Without this, someone who opted out while already low
// (so low_credit_notified_at was never set, per the guard above) would wait
// on their next credit spend to hear anything — which may be a long time,
// or never, since a low balance is often exactly why someone stops
// spending. claimAndSend's own dedup makes this safe to call unconditionally
// on every toggle-to-true, including ones where nothing was actually owed.
async function checkAndNotifyIfAlreadyLow(userId) {
  try {
    const { data: credit } = await supabase
      .from('credits')
      .select('balance')
      .eq('user_id', userId)
      .single()
    if (!credit) return
    const priorTransactionCount = await priorTransactionCountFor(userId)
    if (!shouldConsiderNudge(credit.balance, priorTransactionCount)) return
    await claimAndSend(userId, credit.balance)
  } catch (e) {
    console.error('[LOW_CREDIT_NUDGE] Failed immediate re-enable check for user', userId, e.message)
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
  nudgeEnabledFromPrefs,
  maybeSendLowCreditNudge,
  resetLowCreditNotificationIfToppedUp,
  checkAndNotifyIfAlreadyLow
}
