const { canConfirmAttendance } = require('../utils/attendanceConfirm')

describe('canConfirmAttendance', () => {
  const now = new Date('2026-07-31T12:00:00Z')

  test('rejects a session scheduled in the future', () => {
    expect(canConfirmAttendance('2026-07-31T13:00:00Z', now)).toBe(false)
  })

  test('allows a session that already started', () => {
    expect(canConfirmAttendance('2026-07-31T11:00:00Z', now)).toBe(true)
  })

  test('allows a session starting at exactly now', () => {
    expect(canConfirmAttendance('2026-07-31T12:00:00Z', now)).toBe(true)
  })
})
