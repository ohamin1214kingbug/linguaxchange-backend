// cancelClass used to read the sessions and the booked students without
// checking for errors, after (for the students) already marking the class
// cancelled. A failed read left a cancelled class whose students were never
// refunded or told, with nothing logged. Every read now happens, and is
// checked, before the first write.

const mockCalls = []
let mockFail = null // table whose select should error

function mockBuilder(table) {
  const call = { table, op: 'select' }
  mockCalls.push(call)
  const result = () => {
    if (call.op === 'select' && table === mockFail) return { data: null, error: { message: 'connection reset' } }
    if (call.op === 'select' && table === 'class_sessions') {
      return { data: [{ id: 101, status: 'scheduled', session_date: '2999-01-01T10:00:00Z' }], error: null }
    }
    if (call.op === 'select' && table === 'class_enrollments') {
      return { data: [{ id: 7, user_id: 12, users: { email: 'ana@example.com', first_name: 'Ana' } }], error: null }
    }
    return { data: null, error: null }
  }
  const b = {
    select: () => b,
    update: () => { call.op = 'update'; return b },
    insert: () => { call.op = 'insert'; return Promise.resolve({ error: null }) },
    eq: () => b,
    in: () => b,
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  }
  return b
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: table => mockBuilder(table),
    rpc: (fn, args) => { mockCalls.push({ rpc: fn, args }); return Promise.resolve({ data: 4, error: null }) },
  }),
}))
jest.mock('../utils/mailer', () => ({ sendEmail: jest.fn(() => Promise.resolve({ ok: true })) }))

const { cancelClass } = require('../utils/classCancellation')
const { sendEmail } = require('../utils/mailer')

const writes = () => mockCalls.filter(c => c.op === 'update' || c.op === 'insert' || c.rpc)

beforeEach(() => { mockCalls.length = 0; mockFail = null; sendEmail.mockClear() })

describe('cancelClass', () => {
  test.each(['class_sessions', 'class_enrollments'])('a failed %s read throws before anything is cancelled', async table => {
    mockFail = table
    await expect(cancelClass(5, { status: 'approved', title: 'Korean A1' })).rejects.toThrow()
    expect(writes()).toEqual([])
    expect(sendEmail).not.toHaveBeenCalled()
  })

  test('otherwise cancels, refunds and notifies each booked student', async () => {
    const result = await cancelClass(5, { status: 'approved', title: 'Korean A1' })
    expect(result).toEqual({ alreadyCancelled: false, refundedCount: 1 })
    expect(mockCalls.filter(c => c.op === 'update').map(c => c.table)).toEqual(['classes', 'class_sessions', 'class_enrollments'])
    expect(mockCalls).toContainEqual({ rpc: 'add_credit', args: { p_user_id: 12, p_amount: 1 } })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })
})
