jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({})
}))

const { initialClassStatus } = require('../utils/classApproval')

describe('initialClassStatus', () => {
  test('publishes immediately for a teacher whose account is already approved', () => {
    expect(initialClassStatus(true)).toBe('approved')
  })

  test('goes to pending review for a teacher whose account is not yet approved', () => {
    expect(initialClassStatus(false)).toBe('pending')
  })
})
