// A banana added from the admin page is a gift, not teaching. Logged as
// 'earned', creditSpendGate counted it as "has taught" and unlocked the
// member's last banana; it must be 'bonus'.

const mockFrom = jest.fn()
const mockRpc = jest.fn()
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args) => mockFrom(...args), rpc: (...args) => mockRpc(...args) }),
}))
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, res, next) => next(),
  requireAdmin: (req, res, next) => next(),
}))
jest.mock('../utils/mailer', () => ({ sendEmail: jest.fn() }))
jest.mock('../utils/lowCreditNudge', () => ({ resetLowCreditNotificationIfToppedUp: jest.fn() }))

const router = require('../routes/admin')

function chain(result) {
  const builder = {}
  ;['select', 'eq', 'insert'].forEach((m) => { builder[m] = jest.fn(() => builder) })
  builder.then = (resolve) => resolve(result)
  return builder
}

function dispatch(req) {
  return new Promise((resolve) => {
    const res = {}
    res.status = (code) => { res.statusCode = code; return res }
    res.json = (body) => { res.body = body; resolve(res); return res }
    router.handle(req, res, () => resolve(res))
  })
}

test('an admin grant is logged as bonus, not earned', async () => {
  mockRpc.mockResolvedValue({ data: 5, error: null })
  const ledger = chain({ error: null })
  mockFrom.mockReturnValueOnce(ledger).mockReturnValueOnce(chain({ error: null }))

  const res = await dispatch({ method: 'POST', url: '/users/12/credit', headers: {}, body: { amount: 2 } })

  expect(res.body).toEqual({ success: true, balance: 5 })
  expect(ledger.insert.mock.calls[0][0][0]).toMatchObject({ user_id: '12', amount: 2, type: 'bonus' })
})
