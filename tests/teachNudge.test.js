jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
const { shouldNudge, teachNudgeEmail } = require('../utils/teachNudge')

const now = new Date('2026-11-16T12:00:00Z')
const base = { prefs: {}, sentAt: null, ownUpcoming: 0, learners: 3, now }

test('nudges a teacher with learners waiting and nothing scheduled', () => {
  expect(shouldNudge(base)).toBe(true)
})
test('not when turned off, already teaching, nobody learning, or emailed in the last 14 days', () => {
  expect(shouldNudge({ ...base, prefs: { teach_nudge: false } })).toBe(false)
  expect(shouldNudge({ ...base, ownUpcoming: 1 })).toBe(false)
  expect(shouldNudge({ ...base, learners: 0 })).toBe(false)
  expect(shouldNudge({ ...base, upcoming: 2 })).toBe(false)
  expect(shouldNudge({ ...base, sentAt: '2026-11-10T12:00:00Z' })).toBe(false)
  expect(shouldNudge({ ...base, sentAt: '2026-11-01T12:00:00Z' })).toBe(true)
})
test('the email names the language and links to a prefilled class form', () => {
  const mail = teachNudgeEmail({ firstName: 'Lena', code: 'DE', learners: 3, upcoming: 0 })
  expect(mail.subject).toBe('3 members want to learn German on GongbuLeng')
  expect(mail.text).toContain("there's no German class")
  expect(mail.html).toContain('/classes/create?language_code=DE')
})
