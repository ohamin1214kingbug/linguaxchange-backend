// Dismissing or resolving a report needs a written reason (2026-11-17).
const mockFrom = jest.fn(() => { throw new Error('should not reach the database') })
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (...a) => mockFrom(...a) }) }))
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.userId = 1; next() },
  requireAdmin: (req, res, next) => next(),
}))
jest.mock('../utils/adminLog', () => ({ logAdminAction: jest.fn() }))

const router = require('../routes/reports')

function dispatch(req) {
  return new Promise((resolve) => {
    const res = {}
    res.status = (code) => { res.statusCode = code; return res }
    res.json = (body) => { res.body = body; resolve(res); return res }
    router.handle({ headers: {}, ...req }, res, () => resolve(res))
  })
}

test.each(['rejected', 'resolved'])('closing as %s without a reason is refused', async (status) => {
  const res = await dispatch({ method: 'PATCH', url: '/9', body: { status, notes: '   ' } })
  expect(res.statusCode).toBe(400)
  expect(res.body.error).toMatch(/why/)
  expect(mockFrom).not.toHaveBeenCalled()
})
