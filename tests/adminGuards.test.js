// One test report against the owner's own account let an admin suspend
// themselves for 30 days (2026-11-17). Suspending or deleting your own
// account, or another admin's, is refused before anything is touched.

const mockFrom = jest.fn(() => { throw new Error('should not reach the database') })
const mockIsAdmin = jest.fn()
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (...args) => mockFrom(...args) }) }))
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.userId = 1; next() },
  requireAdmin: (req, res, next) => next(),
  isAdmin: (...args) => mockIsAdmin(...args),
}))
jest.mock('../utils/mailer', () => ({ sendEmail: jest.fn() }))

const router = require('../routes/admin')

function dispatch(req) {
  return new Promise((resolve) => {
    const res = {}
    res.status = (code) => { res.statusCode = code; return res }
    res.json = (body) => { res.body = body; resolve(res); return res }
    router.handle({ headers: {}, userId: 1, ...req }, res, () => resolve(res))
  })
}

const suspend = id => dispatch({ method: 'POST', url: `/users/${id}/suspend`, body: { until: '2027-01-01T00:00:00Z', reason: 'x' } })

test('an admin cannot suspend their own account', async () => {
  mockIsAdmin.mockResolvedValue(false)
  const res = await suspend(1)
  expect(res.statusCode).toBe(400)
  expect(res.body.error).toMatch(/your own account/)
  expect(mockFrom).not.toHaveBeenCalled()
})

test('an admin cannot suspend or delete another admin', async () => {
  mockIsAdmin.mockResolvedValue(true)
  const s = await suspend(2)
  const d = await dispatch({ method: 'POST', url: '/users/2/delete', body: {} })
  expect([s.statusCode, d.statusCode]).toEqual([400, 400])
  expect(s.body.error).toMatch(/admin account/)
  expect(mockFrom).not.toHaveBeenCalled()
})
