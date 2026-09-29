// refundExpiredRequests claims each expired class request (credit_refunded_at
// set) before refunding it, so two overlapping cron ticks can't refund twice.
// It used to ignore whether the refund itself worked: a failed add_credit left
// the request marked refunded, the student without their credit, the sweep
// counting it as refunded, and nothing logged. It now un-claims on failure so
// the next tick retries — the same rule refundExpiredAssignments follows.

const mockUpdates = []
let mockAddCredit = { data: 5, error: null }

function mockBuilder(table) {
  let payload = null
  const b = {
    select: () => b,
    update: p => { payload = p; mockUpdates.push({ table, payload }); return b },
    insert: () => Promise.resolve({ error: null }),
    eq: () => b,
    is: () => b,
    lt: () => b,
    then: (resolve, reject) => {
      // The claim returns the claimed row; the initial read returns one stale request.
      const data = payload ? (payload.credit_refunded_at ? [{ id: 1 }] : null) : [{ id: 1, student_id: 12, topic: 'Korean A1 on Fridays' }]
      return Promise.resolve({ data, error: null }).then(resolve, reject)
    },
  }
  return b
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: table => mockBuilder(table),
    rpc: () => Promise.resolve(mockAddCredit),
  }),
}))
jest.mock('../utils/lowCreditNudge', () => ({ maybeSendLowCreditNudge: jest.fn(), resetLowCreditNotificationIfToppedUp: jest.fn() }))

const { refundExpiredRequests } = require('../utils/requestCredits')

let errorSpy
beforeEach(() => {
  mockUpdates.length = 0
  mockAddCredit = { data: 5, error: null }
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

describe('refundExpiredRequests', () => {
  test('refunds a claimed request and leaves the claim in place', async () => {
    await expect(refundExpiredRequests()).resolves.toEqual({ refunded: 1 })
    expect(mockUpdates.map(u => u.payload.credit_refunded_at === null)).toEqual([false])
  })

  test('a refund that fails is un-claimed for the next tick, logged, and not counted', async () => {
    mockAddCredit = { data: null, error: { message: 'connection reset' } }
    await expect(refundExpiredRequests()).resolves.toEqual({ refunded: 0 })
    expect(mockUpdates.map(u => u.payload)).toEqual([
      { credit_refunded_at: expect.any(String) },
      { credit_refunded_at: null },
    ])
    expect(errorSpy.mock.calls.map(c => c.join(' ')).join('\n')).toContain('[CREDIT_LEDGER]')
  })
})
