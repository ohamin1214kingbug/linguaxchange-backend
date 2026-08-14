// Anonymize, don't DELETE. classes, class_enrollments, class_reviews and
// credit_transactions all reference users(id) ON DELETE CASCADE, so removing
// the row would take other students' booking history — and the financial
// record — with it. GDPR's right to erasure explicitly allows retaining data
// needed for other parties' legitimate interests and for financial
// record-keeping; anonymizing the person out of the rows is that pattern.

// Every column on public.users that carries something personal. Kept as one
// explicit map so adding a PII column and forgetting to scrub it is a
// visible omission here rather than a silent leak. Verified against
// information_schema, not guessed.
function anonymizedFields(userId, now = new Date()) {
  return {
    // Unique + obviously non-routable. The address is a UNIQUE column, so it
    // can't just be nulled, and /google-login matches accounts BY EMAIL —
    // parking it on a reserved-by-RFC domain means no future Google sign-in
    // can ever re-attach to this row.
    email: `deleted-${userId}@deleted.invalid`,

    first_name: 'Deleted',
    last_name: 'User',
    nationality: null,
    photo_url: null,
    bio: null,
    approval_reason: null,

    // Teaching/learning profile — content they authored about themselves.
    teach_language: null,
    teach_level: null,
    learn_languages: null,
    has_certificate: null,
    certificate_explanation: null,

    // Credentials and contact. Nulling both password_hash and google_id is
    // what actually makes the account unreachable; token_valid_after kills
    // every session already issued.
    password_hash: null,
    google_id: null,
    phone_number: null,
    phone_verified: false,
    reset_token: null,
    reset_token_expires: null,
    token_valid_after: now.toISOString(),

    // Coarse location signal.
    timezone: null,
    timezone_source: 'auto',
    time_format: null,

    // Stops them being listed or treated as an active teacher.
    is_approved: false,
    deleted_at: now.toISOString()
  }
}

// Rows that exist only for this user and mean nothing to anyone else once
// they're gone. Everything not listed here is deliberately retained:
// classes / class_sessions / class_enrollments / class_reviews (other
// people's history), credit_transactions (financial record), reports and
// student_feedback (moderation + other users' submissions).
//
// saved_teachers is cleared in BOTH directions — their own bookmarks, and
// other people's bookmarks pointing at them, which would otherwise render as
// a "Deleted User" card in someone else's saved list.
const OWN_DATA_DELETIONS = [
  { table: 'saved_teachers', column: 'user_id' },
  { table: 'saved_teachers', column: 'teacher_id' },
  { table: 'notifications', column: 'user_id' },
  { table: 'class_request_interest', column: 'user_id' },
  { table: 'class_requests', column: 'student_id' },
  { table: 'user_native_languages', column: 'user_id' },
  { table: 'user_learning_languages', column: 'user_id' },
  { table: 'language_credentials', column: 'user_id' }
]

module.exports = { anonymizedFields, OWN_DATA_DELETIONS }
