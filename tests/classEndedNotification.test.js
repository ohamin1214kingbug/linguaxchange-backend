jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
jest.mock('../utils/push', () => ({ pushNotifications: () => {} }))
const { isRecentlyEnded } = require('../utils/inAppNotifications')

const now = new Date('2026-11-13T20:00:00Z')
const at = (iso, duration = 60) => ({ session_date: iso, classes: { duration_minutes: duration } })

test('waits ten minutes after the class ends', () => {
  expect(isRecentlyEnded(at('2026-11-13T18:55:00Z'), now)).toBe(false) // ended 19:55
  expect(isRecentlyEnded(at('2026-11-13T18:50:00Z'), now)).toBe(true)  // ended 19:50
})

test('uses the class length', () => {
  expect(isRecentlyEnded(at('2026-11-13T19:00:00Z', 45), now)).toBe(true)   // ended 19:45
  expect(isRecentlyEnded(at('2026-11-13T19:00:00Z', 90), now)).toBe(false)  // ends 20:30
})

// The first run after deploy must not notify about old classes.
test('ignores classes that ended more than a day ago', () => {
  expect(isRecentlyEnded(at('2026-11-12T18:00:00Z'), now)).toBe(false)
  expect(isRecentlyEnded(at('2026-11-12T20:30:00Z'), now)).toBe(true)
})
