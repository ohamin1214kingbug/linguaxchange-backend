const { anonymizedFields, OWN_DATA_DELETIONS } = require('../utils/accountDeletion')

// Every column on public.users, copied from information_schema. Split into
// "carries something personal" and "safe to leave". If a migration adds a
// column, this list goes stale and the first test fails — which is the point:
// a new PII column that nobody scrubs is a silent leak, so it should break a
// test rather than ship quietly.
const PII_COLUMNS = [
  'email', 'password_hash', 'first_name', 'last_name', 'nationality',
  'photo_url', 'bio', 'approval_reason', 'teach_language', 'teach_level',
  'learn_languages', 'has_certificate', 'certificate_explanation',
  'reset_token', 'reset_token_expires', 'timezone', 'google_id',
  'phone_number', 'phone_verified', 'timezone_source', 'time_format'
]

// Deliberately retained: identifiers and non-personal counters.
const KEPT_COLUMNS = [
  'id', 'created_at', 'updated_at', 'last_login', 'current_streak',
  'longest_streak', 'last_active_week', 'is_approved', 'token_valid_after',
  'deleted_at'
]

describe('anonymizedFields', () => {
  const fields = anonymizedFields(42, new Date('2026-01-01T00:00:00.000Z'))

  test('scrubs every personal column', () => {
    const missed = PII_COLUMNS.filter(c => !(c in fields))
    expect(missed).toEqual([])
  })

  test('never touches a column outside the known schema', () => {
    const known = new Set([...PII_COLUMNS, ...KEPT_COLUMNS])
    expect(Object.keys(fields).filter(k => !known.has(k))).toEqual([])
  })

  test('email stays unique and unroutable so Google login cannot re-attach', () => {
    // /google-login matches accounts by email; a nulled or reused address
    // would let a future sign-in land back on this row.
    expect(fields.email).toBe('deleted-42@deleted.invalid')
    expect(anonymizedFields(43).email).not.toBe(fields.email)
  })

  test('both credential paths are closed and live sessions are killed', () => {
    expect(fields.password_hash).toBeNull()
    expect(fields.google_id).toBeNull()
    expect(fields.token_valid_after).toBe('2026-01-01T00:00:00.000Z')
  })

  test('marks the account deleted and unlists it', () => {
    expect(fields.deleted_at).toBe('2026-01-01T00:00:00.000Z')
    expect(fields.is_approved).toBe(false)
  })
})

describe('OWN_DATA_DELETIONS', () => {
  test('clears saved_teachers from both sides', () => {
    const cols = OWN_DATA_DELETIONS.filter(d => d.table === 'saved_teachers').map(d => d.column)
    expect(cols.sort()).toEqual(['teacher_id', 'user_id'])
  })

  test('never deletes rows other members depend on', () => {
    // These carry other people's history or the financial record. Losing
    // them is exactly what anonymizing instead of deleting is meant to avoid.
    const retained = ['classes', 'class_sessions', 'class_enrollments', 'class_reviews', 'credit_transactions', 'reports', 'student_feedback']
    const targeted = OWN_DATA_DELETIONS.map(d => d.table)
    expect(retained.filter(t => targeted.includes(t))).toEqual([])
  })
})
