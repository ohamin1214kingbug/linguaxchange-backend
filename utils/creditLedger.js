// Every balance change writes a matching credit_transactions row, and by the
// time it does the balance has already moved (spend_credit / add_credit ran
// first). The inserts used to be bare awaits: a failure vanished, leaving a
// balance the history could not explain — user 12 ended up 1 credit off with
// no rows at all, found only by reconciling balances against the ledger.
//
// Logs rather than throws. Undoing a real join or refund because only its
// history failed to save would hurt the student for a bookkeeping error; the
// logged row carries everything needed to write it back by hand.
async function recordCreditTransaction(client, row) {
  const { error } = await client.from('credit_transactions').insert([row])
  if (!error) return true
  console.error('[CREDIT_LEDGER] balance moved but its history row was not saved:', JSON.stringify(row), error.message)
  return false
}

module.exports = { recordCreditTransaction }
