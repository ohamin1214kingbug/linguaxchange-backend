const REFUND_CUTOFF_MS = 24 * 60 * 60 * 1000

// Pure. A student cancelling their own booking gets the credit back only
// if they do it 24h+ before the session — inside that window the seat was
// already effectively held from other students.
function canRefundCancellation(sessionDate, now = new Date()) {
  return new Date(sessionDate).getTime() - now.getTime() >= REFUND_CUTOFF_MS
}

// Pure. A student may cancel a booking only before the session starts.
// Afterwards the booking is what pays the teacher (attendance payout), and
// deleting it would take that banana away (found 2026-11-27).
function canCancelBooking(sessionDate, now = new Date()) {
  return new Date(sessionDate).getTime() > now.getTime()
}

module.exports = { canRefundCancellation, canCancelBooking, REFUND_CUTOFF_MS }
