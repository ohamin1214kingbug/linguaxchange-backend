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
//
// `retryable` tells the caller whether it's safe to retry (nothing happened,
// or the reversal above already undid it) or not (the credit was granted and
// could NOT be reversed — a retry would add_credit a second time on top of
// this one, paying twice). Callers that clear a claim to allow a retry must
// check this first; see releaseDueFeedback below (fix round 2, review finding).
async function releaseFeedbackCredit(reviewerId) {
  const { data: balanceAfter, error } = await db()
    .rpc('add_credit', { p_user_id: reviewerId, p_amount: 1 })
  if (error || balanceAfter === null) {
    console.error('feedback credit release failed', error)
    return { ok: false, retryable: true }
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
      return { ok: false, retryable: false }
    }

    return { ok: false, retryable: true }
  }

  return { ok: true, balance: balanceAfter }
}

// A student who never comes back must not leave a reviewer unpaid. At five
// users one unresponsive student is enough to make reviewing feel pointless,
// so the banana releases on its own after this long.
const AUTO_RELEASE_HOURS = 72

// Claimed with a conditional update first, so two overlapping cron ticks
// cannot pay the same reviewer twice — the pattern refundExpiredRequests
// already uses.
async function releaseDueFeedback(now = new Date()) {
  const cutoff = new Date(now.getTime() - AUTO_RELEASE_HOURS * 60 * 60 * 1000)
  let released = 0
  try {
    const { data: due } = await db()
      .from('assignment_feedback')
      .select('id, reviewer_id')
      .is('credit_released_at', null)
      .lt('created_at', cutoff.toISOString())

    for (const row of due || []) {
      const { data: claimed } = await db()
        .from('assignment_feedback')
        .update({ credit_released_at: now.toISOString() })
        .eq('id', row.id)
        .is('credit_released_at', null)
        .select('id')

      if (claimed && claimed.length > 0) {
        const payout = await releaseFeedbackCredit(row.reviewer_id)
        if (payout.ok) {
          released++
        } else if (payout.retryable) {
          // The claim flipped credit_released_at before the payout ran, so a
          // retryable failure must not leave it set — that would hide the row
          // from this same WHERE clause forever, "released" with no pay and
          // no retry.
          const { error: clearError } = await db()
            .from('assignment_feedback')
            .update({ credit_released_at: null })
            .eq('id', row.id)
          if (clearError) {
            console.error(
              'releaseDueFeedback: could not un-claim feedback', row.id,
              '— row is now stuck marked released with NO payout and will never be retried, needs a manual fix',
              clearError
            )
          }
        } else {
          // Not retryable: releaseFeedbackCredit already granted the credit
          // and could not reverse it. Clearing the claim here would let the
          // next tick pay the same reviewer a second time, so the claim is
          // left standing on purpose — loud because nothing else will retry it.
          console.error(
            'releaseDueFeedback: feedback', row.id, 'reviewer', row.reviewer_id,
            'was paid but its audit row and reversal both failed — balance and audit log are out of sync;',
            'leaving credit_released_at set to avoid a double payout, needs a manual fix'
          )
        }
      }
    }
  } catch (e) {
    console.error('releaseDueFeedback failed', e)
  }
  return { released }
}

// An unanswered request expires and the banana goes back. This is the answer
// to the supply problem: a German request nobody can answer costs the student
// nothing but time.
async function refundExpiredAssignments(now = new Date()) {
  const { refundForRequest } = require('./requestCredits')
  let refunded = 0
  try {
    const { data: stale } = await db()
      .from('assignment_requests')
      .select('id, student_id, assignment_feedback(id)')
      .lt('expires_at', now.toISOString())
      .is('credit_refunded_at', null)

    for (const row of stale || []) {
      // Answered requests are not refunded; their banana goes to the reviewer.
      if ((row.assignment_feedback || []).length > 0) continue

      const { data: claimed } = await db()
        .from('assignment_requests')
        .update({ credit_refunded_at: now.toISOString() })
        .eq('id', row.id)
        .is('credit_refunded_at', null)
        .select('id')

      if (claimed && claimed.length > 0) {
        // Unlike releaseFeedbackCredit, refundForRequest has no reversal step
        // of its own — its only failure mode is add_credit itself not running
        // (it returns { ok: false } before ever touching credit_transactions),
        // so there is no "granted but couldn't be recorded" desync to guard
        // against here. Every refund.ok === false is safe to retry.
        const refund = await refundForRequest(row.student_id, 'Assignment request expired unanswered')
        if (refund.ok) {
          refunded++
        } else {
          const { error: clearError } = await db()
            .from('assignment_requests')
            .update({ credit_refunded_at: null })
            .eq('id', row.id)
          if (clearError) {
            console.error(
              'refundExpiredAssignments: could not un-claim request', row.id,
              '— row is now stuck marked refunded with NO refund and will never be retried, needs a manual fix',
              clearError
            )
          }
        }
      }
    }
  } catch (e) {
    console.error('refundExpiredAssignments failed', e)
  }
  return { refunded }
}

module.exports = {
  isOverCap, countFeedbackEarnings, releaseFeedbackCredit, windowStart,
  WEEKLY_FEEDBACK_CAP, FEEDBACK_TYPE, WINDOW_DAYS,
  releaseDueFeedback, refundExpiredAssignments, AUTO_RELEASE_HOURS,
}
