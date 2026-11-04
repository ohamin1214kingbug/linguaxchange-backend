// releaseDueAttendancePayouts pays a teacher 72h after class for every
// student who never pressed "confirm attendance". It claims teacher_paid_at
// before paying (so it can't double-pay with the student's own confirm or an
// overlapping cron tick), skips a student who reported the teacher or class,
// fails closed if reports can't be read, and un-claims a failed payout so the
// next tick retries it.

const mockUpdates = []
const mockRpcs = []
let mockDue
let mockDueError
let mockReports
let mockClaimed
let mockAddCredit

function mockBuilder(table) {
  let payload = null
  const b = {
    select: () => b,
    update: p => { payload = p; mockUpdates.push({ table, payload }); return b },
    insert: () => Promise.resolve({ error: null }),
    eq: () => b, neq: () => b, is: () => b, in: () => b, lt: () => b, gte: () => b, or: () => b, limit: () => b,
    then: (resolve, reject) => {
      let result
      if (table === 'reports') result = mockReports
      else if (payload) result = { data: payload.teacher_paid_at && mockClaimed ? [{ id: 1 }] : [], error: null }
      else result = { data: mockDue, error: mockDueError }
      return Promise.resolve(result).then(resolve, reject)
    },
  }
  return b
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: table => mockBuilder(table),
    rpc: (fn, args) => { mockRpcs.push({ fn, args }); return Promise.resolve(mockAddCredit) },
  }),
}))
jest.mock('../utils/lowCreditNudge', () => ({ resetLowCreditNotificationIfToppedUp: jest.fn() }))

const { releaseDueAttendancePayouts } = require('../utils/attendancePayout')

const dueRow = { id: 1, user_id: 12, class_sessions: { session_date: '2026-10-01T10:00:00Z', status: 'scheduled', classes: { id: 7, teacher_id: 3 } } }

let errorSpy
beforeEach(() => {
  mockUpdates.length = 0
  mockRpcs.length = 0
  mockDue = [dueRow]
  mockDueError = null
  mockReports = { data: [], error: null }
  mockClaimed = true
  mockAddCredit = { data: 4, error: null }
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

test('pays the teacher once the claim is taken', async () => {
  expect(await releaseDueAttendancePayouts()).toEqual({ paid: 1 })
  expect(mockRpcs).toEqual([{ fn: 'add_credit', args: { p_user_id: 3, p_amount: 1 } }])
})

test('holds the payout when the student reported the teacher or class', async () => {
  mockReports = { data: [{ id: 99 }], error: null }
  expect(await releaseDueAttendancePayouts()).toEqual({ paid: 0 })
  expect(mockRpcs).toEqual([])
})

test('pays nothing when reports cannot be read', async () => {
  mockReports = { data: null, error: { message: 'timeout' } }
  expect(await releaseDueAttendancePayouts()).toEqual({ paid: 0 })
  expect(mockRpcs).toEqual([])
})

test('pays nothing when the claim was already taken', async () => {
  mockClaimed = false
  expect(await releaseDueAttendancePayouts()).toEqual({ paid: 0 })
  expect(mockRpcs).toEqual([])
})

test('a failed payout is logged and un-claimed for the next tick', async () => {
  mockAddCredit = { data: null, error: { message: 'connection reset' } }
  expect(await releaseDueAttendancePayouts()).toEqual({ paid: 0 })
  expect(mockUpdates).toContainEqual({ table: 'class_enrollments', payload: { teacher_paid_at: null } })
  expect(errorSpy.mock.calls.map(c => c.join(' ')).join('\n')).toMatch(/\[CREDIT_LEDGER\].*teacher 3/)
})

test('reports null, not 0, when the due query fails', async () => {
  mockDue = null
  mockDueError = { message: 'column does not exist' }
  expect(await releaseDueAttendancePayouts()).toEqual({ paid: null })
  expect(mockRpcs).toEqual([])
  expect(errorSpy.mock.calls.map(c => String(c[0])).join('\n')).toMatch(/releaseDueAttendancePayouts failed/)
})
