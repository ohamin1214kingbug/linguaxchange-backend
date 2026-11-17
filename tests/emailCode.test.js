process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
const jwt = require('jsonwebtoken')
const { newCode, issueCodeToken, checkCode, issueVerifiedToken, isVerifiedFor } = require('../utils/emailCode')

test('a code is 6 digits', () => {
  for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/)
})

test('the right code for the right email passes; anything else fails', () => {
  const token = issueCodeToken('Lucia@UCM.es ', '042917')
  expect(checkCode(token, 'lucia@ucm.es', '042917').ok).toBe(true)
  expect(checkCode(token, 'lucia@ucm.es', '042918').ok).toBe(false)
  expect(checkCode(token, 'other@ucm.es', '042917').ok).toBe(false)
  expect(checkCode('garbage', 'lucia@ucm.es', '042917').ok).toBe(false)
})

test('the token does not reveal the code', () => {
  const token = issueCodeToken('a@b.co', '123456')
  expect(JSON.stringify(jwt.decode(token))).not.toContain('123456')
})

test('the verified token only counts for its own email and purpose', () => {
  const ok = issueVerifiedToken('a@b.co')
  expect(isVerifiedFor(ok, 'A@b.co')).toBe(true)
  expect(isVerifiedFor(ok, 'c@d.co')).toBe(false)
  expect(isVerifiedFor(issueCodeToken('a@b.co', '111111'), 'a@b.co')).toBe(false)
})

describe('isAdminUser', () => {
  const ORIGINAL = process.env.ADMIN_EMAILS
  afterAll(() => { process.env.ADMIN_EMAILS = ORIGINAL })
  test('an admin email counts only once it is confirmed', () => {
    process.env.ADMIN_EMAILS = 'boss@x.co'
    jest.isolateModules(() => {
      jest.doMock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
      const { isAdminUser } = require('../middleware/auth')
      expect(isAdminUser({ email: 'Boss@x.co', email_verified_at: '2026-11-17T00:00:00Z' })).toBe(true)
      expect(isAdminUser({ email: 'boss@x.co', email_verified_at: null })).toBe(false)
      expect(isAdminUser({ email: 'other@x.co', email_verified_at: '2026-11-17T00:00:00Z' })).toBe(false)
      expect(isAdminUser(null)).toBe(false)
    })
  })
})
