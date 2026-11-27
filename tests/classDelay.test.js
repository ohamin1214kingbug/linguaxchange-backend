const { checkDelay } = require('../utils/classDelay')

const at = s => new Date(s)
const base = { sessionDate: '2026-11-27T18:00:00Z', status: 'scheduled', minutes: 10 }

test('moves the start and adds up the minutes', () => {
  const r = checkDelay({ ...base, now: at('2026-11-27T17:55:00Z') })
  expect(r.ok).toBe(true)
  expect(r.newDate.toISOString()).toBe('2026-11-27T18:10:00.000Z')
  expect(r.delayedMinutes).toBe(10)
})

test('at most 15 minutes in total, only 5, 10 or 15 at a time', () => {
  expect(checkDelay({ ...base, sessionDate: '2026-11-27T18:10:00Z', delayedMinutes: 10, minutes: 5, now: at('2026-11-27T18:05:00Z') }).ok).toBe(true)
  expect(checkDelay({ ...base, sessionDate: '2026-11-27T18:10:00Z', delayedMinutes: 10, minutes: 10, now: at('2026-11-27T18:05:00Z') }).ok).toBe(false)
  expect(checkDelay({ ...base, minutes: 7, now: at('2026-11-27T17:55:00Z') }).ok).toBe(false)
})

test('only from 30 minutes before the original start until the no-show cutoff', () => {
  expect(checkDelay({ ...base, now: at('2026-11-27T17:29:00Z') }).ok).toBe(false)
  expect(checkDelay({ ...base, now: at('2026-11-27T18:14:00Z') }).ok).toBe(true)
  expect(checkDelay({ ...base, now: at('2026-11-27T18:16:00Z') }).ok).toBe(false)
  // after one delay the window is measured from the original start, the cutoff from the new one
  expect(checkDelay({ ...base, sessionDate: '2026-11-27T18:05:00Z', delayedMinutes: 5, minutes: 5, now: at('2026-11-27T18:19:00Z') }).ok).toBe(true)
})

test('not once cancelled or already judged', () => {
  expect(checkDelay({ ...base, status: 'cancelled', now: at('2026-11-27T17:55:00Z') }).ok).toBe(false)
  expect(checkDelay({ ...base, teacherCheckedAt: '2026-11-27T18:15:00Z', now: at('2026-11-27T18:10:00Z') }).ok).toBe(false)
})
