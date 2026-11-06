// Approving a member must tell them (the Google welcome email promises it),
// and exactly once: only a not-approved → approved change returns a row.
// Same router.handle() pattern as tests/assignmentAcknowledge.test.js.

const mockFrom = jest.fn()
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args) => mockFrom(...args) }),
}))
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, res, next) => next(),
  requireAdmin: (req, res, next) => next(),
}))
const mockSendEmail = jest.fn()
jest.mock('../utils/mailer', () => ({ sendEmail: (...args) => mockSendEmail(...args) }))

const router = require('../routes/admin')

function chain(result) {
  const builder = {}
  ;['select', 'eq', 'or', 'update', 'insert'].forEach((m) => { builder[m] = jest.fn(() => builder) })
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

const approveReq = id => ({ method: 'POST', url: `/users/${id}/approve`, headers: {} })

beforeEach(() => { jest.resetAllMocks() })

test('emails and notifies the member when the account becomes approved', async () => {
  const notify = chain({ error: null })
  mockFrom.mockReturnValueOnce(chain({ data: [{ id: 'u1', email: 'ana@ucm.es', first_name: 'Ana' }], error: null }))
  mockFrom.mockReturnValueOnce(notify)

  const res = await dispatch(approveReq('u1'))

  expect(res.body).toEqual({ success: true })
  expect(mockSendEmail).toHaveBeenCalledTimes(1)
  expect(mockSendEmail.mock.calls[0][0]).toMatchObject({ to: 'ana@ucm.es', subject: 'Your GongbuLeng account is approved' })
  expect(notify.insert.mock.calls[0][0][0]).toMatchObject({ user_id: 'u1', type: 'account_approved' })
})

test('approving an already-approved member sends nothing again', async () => {
  mockFrom.mockReturnValueOnce(chain({ data: [], error: null }))

  const res = await dispatch(approveReq('u1'))

  expect(res.body).toEqual({ success: true })
  expect(mockSendEmail).not.toHaveBeenCalled()
  expect(mockFrom).toHaveBeenCalledTimes(1)
})

test('a failed notification insert still reports the approval as done', async () => {
  mockFrom.mockReturnValueOnce(chain({ data: [{ id: 'u1', email: 'ana@ucm.es', first_name: 'Ana' }], error: null }))
  mockFrom.mockReturnValueOnce(chain({ error: { message: 'violates check constraint' } }))
  jest.spyOn(console, 'error').mockImplementation(() => {})

  const res = await dispatch(approveReq('u1'))

  expect(res.body).toEqual({ success: true })
  expect(mockSendEmail).toHaveBeenCalledTimes(1)
})
