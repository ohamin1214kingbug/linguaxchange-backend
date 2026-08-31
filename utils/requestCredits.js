const { createClient } = require('@supabase/supabase-js')
const { blocksSpend, hasEverTaught } = require('./creditSpendGate')
const { maybeSendLowCreditNudge, resetLowCreditNotificationIfToppedUp } = require('./lowCreditNudge')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Posting a request costs the same as joining a class, because that is what
// it is: the credit paid here is the payment for the class the request turns
// into. On fulfilment the requester is enrolled without paying again, and if
// nobody answers, this comes back.
const REQUEST_COST = 1

// Mirrors the join flow's gates (routes/enrollments.js) rather than inventing
// its own: same balance check, same "don't drain your last credit without
// ever teaching" rule. A request that a student couldn't afford to attend is
// not worth posting.
async function chargeForRequest(userId) {
  const { data: credit } = await supabase
    .from('credits')
    .select('balance')
    .eq('user_id', userId)
    .single()

  if (!credit || credit.balance < REQUEST_COST) {
    return { ok: false, error: 'Not enough credits' }
  }

  if (blocksSpend(credit.balance - REQUEST_COST, await hasEverTaught(userId))) {
    return {
      ok: false,
      error: "This would use your last credit. Teach a class first to keep earning credits — head to Classes to create one."
    }
  }

  // Atomic conditional spend — the balance read above is advisory only, so
  // the actual deduction must let the DB reject an overspend (NULL result).
  const { data: balanceAfter, error } = await supabase
    .rpc('spend_credit', { p_user_id: userId, p_amount: REQUEST_COST })

  if (error) return { ok: false, error: error.message }
  if (balanceAfter === null) return { ok: false, error: 'Not enough credits' }

  await supabase.from('credit_transactions').insert([{
    user_id: userId,
    amount: -REQUEST_COST,
    type: 'spent',
    description: 'Posted a class request'
  }])

  await maybeSendLowCreditNudge(userId, balanceAfter)
  return { ok: true, balance: balanceAfter }
}

// Used when a request is withdrawn, expires unanswered, or was fulfilled but
// the auto-enrolment failed. `description` says which, so the student's
// transaction history explains where the credit came from.
async function refundForRequest(userId, description) {
  // Atomic add. NULL means no credits row to refund into.
  const { data: balanceAfter } = await supabase
    .rpc('add_credit', { p_user_id: userId, p_amount: REQUEST_COST })

  if (balanceAfter === null) return { ok: false }

  await supabase.from('credit_transactions').insert([{
    user_id: userId,
    amount: REQUEST_COST,
    type: 'refunded',
    description
  }])

  await resetLowCreditNotificationIfToppedUp(userId, balanceAfter)
  return { ok: true, balance: balanceAfter }
}

// Gives back the credit for every request that has expired without anyone
// answering it. Claimed with a conditional UPDATE first: two overlapping
// cron ticks would otherwise both read the same row and refund it twice.
async function refundExpiredRequests(now = new Date()) {
  let refunded = 0
  try {
    const { data: stale } = await supabase
      .from('class_requests')
      .select('id, student_id, topic')
      .lt('expires_at', now.toISOString())
      .is('fulfilled_class_id', null)
      .is('credit_refunded_at', null)

    for (const request of stale || []) {
      const { data: claimed } = await supabase
        .from('class_requests')
        .update({ credit_refunded_at: now.toISOString() })
        .eq('id', request.id)
        .is('credit_refunded_at', null)
        .select('id')

      if (!claimed || claimed.length === 0) continue // another tick got it

      await refundForRequest(request.student_id, `Request expired unanswered: ${request.topic}`)
      refunded++
    }
  } catch (e) {
    console.error('[REQUEST_REFUND] sweep failed', e.message)
  }
  return { refunded }
}

module.exports = { REQUEST_COST, chargeForRequest, refundForRequest, refundExpiredRequests }
