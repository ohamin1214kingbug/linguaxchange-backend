process.env.JWT_SECRET = 'test-secret'
process.env.ADMIN_EMAILS = 'admin@example.com'

const jwt = require('jsonwebtoken')

// requireAdmin queries Supabase for the user's email — mock the client
// so this stays a fast, isolated unit test with no network/DB dependency.
let mockUserRow
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve(mockUserRow)
        })
      })
    })
  })
}))

const { requireAuth, requireAdmin } = require('../middleware/auth')

function mockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe('requireAuth', () => {
  test('rejects a request with no Authorization header', () => {
    const req = { headers: {} }
    const res = mockRes()
    const next = jest.fn()

    requireAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  test('rejects a header that is not a Bearer token', () => {
    const req = { headers: { authorization: 'Basic abc123' } }
    const res = mockRes()
    const next = jest.fn()

    requireAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  test('rejects an invalid token', () => {
    const req = { headers: { authorization: 'Bearer not-a-real-token' } }
    const res = mockRes()
    const next = jest.fn()

    requireAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  test('rejects an expired token', () => {
    const expiredToken = jwt.sign({ userId: 1 }, process.env.JWT_SECRET, { expiresIn: -10 })
    const req = { headers: { authorization: `Bearer ${expiredToken}` } }
    const res = mockRes()
    const next = jest.fn()

    requireAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  test('accepts a valid token and attaches userId to the request', () => {
    const token = jwt.sign({ userId: 42 }, process.env.JWT_SECRET, { expiresIn: '1h' })
    const req = { headers: { authorization: `Bearer ${token}` } }
    const res = mockRes()
    const next = jest.fn()

    requireAuth(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.userId).toBe(42)
    expect(res.status).not.toHaveBeenCalled()
  })

  test('rejects a token signed with a different secret', () => {
    const token = jwt.sign({ userId: 1 }, 'wrong-secret', { expiresIn: '1h' })
    const req = { headers: { authorization: `Bearer ${token}` } }
    const res = mockRes()
    const next = jest.fn()

    requireAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })
})

describe('requireAdmin', () => {
  test('allows a user whose email is in ADMIN_EMAILS', async () => {
    mockUserRow = { data: { email: 'admin@example.com' }, error: null }
    const req = { userId: 1 }
    const res = mockRes()
    const next = jest.fn()

    await requireAdmin(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  test('is case-insensitive when matching admin emails', async () => {
    mockUserRow = { data: { email: 'Admin@Example.com' }, error: null }
    const req = { userId: 1 }
    const res = mockRes()
    const next = jest.fn()

    await requireAdmin(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  test('rejects a user whose email is not in ADMIN_EMAILS', async () => {
    mockUserRow = { data: { email: 'nobody@example.com' }, error: null }
    const req = { userId: 2 }
    const res = mockRes()
    const next = jest.fn()

    await requireAdmin(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  test('rejects when the user lookup errors', async () => {
    mockUserRow = { data: null, error: { message: 'not found' } }
    const req = { userId: 999 }
    const res = mockRes()
    const next = jest.fn()

    await requireAdmin(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })
})
