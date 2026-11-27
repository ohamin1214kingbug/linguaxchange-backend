const { cleanSlots, heatmap } = require('../utils/availability')

const now = new Date('2026-11-27T12:00:00Z')

test('keeps future slots on the hour or half hour within 7 days, sorted, no duplicates', () => {
  expect(cleanSlots([
    '2026-11-28T19:00:00Z', '2026-11-28T18:00:00.000Z', '2026-11-28T19:00:00Z', // duplicate
    '2026-11-28T13:30:00Z',             // India's whole hour
    '2026-11-28T13:15:00Z',             // off the half hour
    '2026-11-27T11:00:00Z',             // past
    '2026-12-05T13:00:00Z',             // more than 7 days ahead
    'nonsense', 42, null,
  ], now)).toEqual(['2026-11-28T13:30:00.000Z', '2026-11-28T18:00:00.000Z', '2026-11-28T19:00:00.000Z'])
})

test('not a list is refused; an empty list clears', () => {
  expect(cleanSlots('2026-11-28T19:00:00Z', now)).toBeNull()
  expect(cleanSlots([], now)).toEqual([])
})

test('heatmap counts people per slot, busiest first, with first names; past slots drop', () => {
  const rows = [
    { user_id: 1, first_name: 'Minji', slots: ['2026-11-28T19:00:00.000Z', '2026-11-28T20:00:00.000Z'] },
    { user_id: 2, first_name: 'Ana', slots: ['2026-11-28T19:00:00.000Z'] },
    { user_id: 3, first_name: 'Tom', slots: ['2026-11-27T10:00:00.000Z', '2026-11-28T19:00:00.000Z'] },
  ]
  expect(heatmap(rows, now)).toEqual([
    { slot: '2026-11-28T19:00:00.000Z', count: 3, names: ['Minji', 'Ana', 'Tom'] },
    { slot: '2026-11-28T20:00:00.000Z', count: 1, names: ['Minji'] },
  ])
})
