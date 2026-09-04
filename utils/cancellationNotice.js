// Pure on purpose: no imports, so its tests run with no environment.
//
// classCancellation.js builds a Supabase client at module load, and a test
// that only wants to check wording cannot require that. The same split as
// accountDeletion.js — what gets said lives apart from what gets done.

// What the student is told. Split out from the send so the wording can be
// checked without a mail server.
//
// The platform wording says nothing about why. A class cancelled because the
// teacher was suspended must not tell their students that — the reason is
// moderation information about someone else, and "cancelled by the teacher"
// would be a plain lie about a person who did not cancel anything.
function cancellationNotice({ title, firstName, byPlatform = false }) {
  const name = firstName || ''
  return byPlatform
    ? `Hi ${name},\n\nThe class '${title}' has been cancelled and your credit has been refunded.\n\nSorry for the disruption — you can book another class any time.`
    : `Hi ${name}, the class '${title}' has been cancelled by the teacher. Your credit has been refunded.`
}

module.exports = { cancellationNotice }
