jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
const { retentionCutoffs } = require('../utils/chatRetention')

test('class chats expire 90 days after closing (class + 24h, classes up to 4h); deleted messages after 30 days', () => {
  const now = new Date('2027-03-01T12:00:00Z')
  const c = retentionCutoffs(now)
  // 90 days back is 2026-12-01T12:00Z; a class chat closes up to 28h after the class starts.
  expect(c.requestsBefore).toBe('2026-12-01T12:00:00.000Z')
  expect(c.sessionsBefore).toBe('2026-11-30T08:00:00.000Z')
  expect(c.deletedBefore).toBe('2027-01-30T12:00:00.000Z')
})
