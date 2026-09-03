// Whether an account is locked out right now.
//
// A lapsed suspension is not swept by any job, so "suspended" is a
// comparison against the stored end date rather than a NULL check. That also
// makes unsuspending nothing more than clearing the column.
function isSuspended({ suspendedUntil, now = new Date() }) {
  if (!suspendedUntil) return { suspended: false, until: null }

  const until = new Date(suspendedUntil)
  if (Number.isNaN(until.getTime())) {
    // Bad data must not become a silent permanent ban.
    console.error('[SUSPENSION] Unparseable suspended_until:', suspendedUntil)
    return { suspended: false, until: null }
  }

  return { suspended: now < until, until }
}

module.exports = { isSuspended }
