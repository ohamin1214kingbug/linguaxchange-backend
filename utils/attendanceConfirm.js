// A student could otherwise enroll and immediately self-confirm attendance,
// minting the teacher a credit for a class that never happened — this is
// the only check standing between that and the credit system's integrity.
function canConfirmAttendance(sessionDate, now = new Date()) {
  return new Date(sessionDate).getTime() <= now.getTime()
}

module.exports = { canConfirmAttendance }
