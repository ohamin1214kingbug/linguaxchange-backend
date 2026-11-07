// Invite a friend: an invited member's first class pays a banana to them and
// to whoever invited them, exactly once, and never as 'earned' (which would
// count as having taught and unlock the last banana).

const mockFrom = jest.fn()
const mockRpc = jest.fn()
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args) => mockFrom(...args), rpc: (...args) => mockRpc(...args) }),
}))

const { parseInviteCode, rewardReferral, MAX_REWARDED_INVITES } = require('../utils/referrals')

function chain(result) {
  const builder = {}
  ;['select', 'eq', 'is', 'not', 'update', 'insert', 'maybeSingle'].forEach((m) => { builder[m] = jest.fn(() => builder) })
  builder.then = (resolve) => resolve(result)
  return builder
}

beforeEach(() => {
  jest.resetAllMocks()
  mockRpc.mockResolvedValue({ data: 4, error: null })
})

describe('parseInviteCode', () => {
  test('member codes in any reasonable spelling', () => {
    expect(parseInviteCode('U000012')).toBe(12)
    expect(parseInviteCode('u12')).toBe(12)
    expect(parseInviteCode(' 12 ')).toBe(12)
  })

  test('anything else is no code', () => {
    expect(parseInviteCode('')).toBeNull()
    expect(parseInviteCode(undefined)).toBeNull()
    expect(parseInviteCode('U000000')).toBeNull()
    expect(parseInviteCode('12abc')).toBeNull()
  })
})

test('first class of an invited member pays both, as bonus', async () => {
  const claim = chain({ data: [{ id: 5, first_name: 'Ana', referred_by: 2 }], error: null })
  const ledger1 = chain({ error: null })
  const count = chain({ count: 1, error: null })
  const ledger2 = chain({ error: null })
  const notify = chain({ error: null })
  mockFrom
    .mockReturnValueOnce(claim)
    .mockReturnValueOnce(ledger1)
    .mockReturnValueOnce(count)
    .mockReturnValueOnce(ledger2)
    .mockReturnValueOnce(notify)

  await expect(rewardReferral(5)).resolves.toEqual({ rewarded: true, referrerPaid: true })
  expect(claim.is).toHaveBeenCalledWith('referral_rewarded_at', null)
  expect(mockRpc.mock.calls.map(c => c[1].p_user_id)).toEqual([5, 2])
  expect(ledger1.insert.mock.calls[0][0][0].type).toBe('bonus')
  expect(ledger2.insert.mock.calls[0][0][0].type).toBe('bonus')
  expect(notify.insert.mock.calls[0][0]).toHaveLength(2)
})

test('already rewarded, or not invited: nothing is paid', async () => {
  mockFrom.mockReturnValueOnce(chain({ data: [], error: null }))
  await expect(rewardReferral(5)).resolves.toEqual({ rewarded: false })
  expect(mockRpc).not.toHaveBeenCalled()
})

test('past the cap the friend is still paid but the inviter is not', async () => {
  mockFrom
    .mockReturnValueOnce(chain({ data: [{ id: 5, first_name: 'Ana', referred_by: 2 }], error: null }))
    .mockReturnValueOnce(chain({ error: null }))
    .mockReturnValueOnce(chain({ count: MAX_REWARDED_INVITES + 1, error: null }))
    .mockReturnValueOnce(chain({ error: null }))

  await expect(rewardReferral(5)).resolves.toEqual({ rewarded: true, referrerPaid: false })
  expect(mockRpc.mock.calls.map(c => c[1].p_user_id)).toEqual([5])
})

test('a failing claim (column not there yet) pays nothing and does not throw', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
  mockFrom.mockReturnValueOnce(chain({ data: null, error: { message: 'column users.referred_by does not exist' } }))
  await expect(rewardReferral(5)).resolves.toEqual({ rewarded: false })
  expect(mockRpc).not.toHaveBeenCalled()
  spy.mockRestore()
})
