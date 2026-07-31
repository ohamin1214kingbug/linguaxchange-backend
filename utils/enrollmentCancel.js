const REFUND_CUTOFF_MS = 24 * 60 * 60 * 1000

// Pure. A student cancelling their own booking gets the credit back only
// if they do it 24h+ before the session — inside that window the seat was
// already effectively held from other students.
function canRefundCancellation(sessionDate, now = new Date()) {
  return new Date(sessionDate).getTime() - now.getTime() >= REFUND_CUTOFF_MS
}

module.exports = { canRefundCancellation, REFUND_CUTOFF_MS }
