// Approving a member must tell them (the welcome email promises it), exactly
// once: only a not-approved → approved change returns a row. It also
// publishes the classes they created while waiting (utils/memberApproval.js).
// Call order: users update, pending classes read, [classes update], notification.
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

const mockNotifyClassAlerts = jest.fn()
jest.mock('../utils/classAlerts', () => ({ notifyClassAlerts: (...args) => mockNotifyClassAlerts(...args) }))

const router = require('../routes/admin')
const { approveMember } = require('../utils/memberApproval')

const ana = { id: 'u1', email: 'ana@ucm.es', first_name: 'Ana' }
const noClasses = () => chain({ data: [], error: null })

function chain(result) {
  const builder = {}
  ;['select', 'eq', 'or', 'is', 'in', 'update', 'insert'].forEach((m) => { builder[m] = jest.fn(() => builder) })
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
  mockFrom.mockReturnValueOnce(chain({ data: [ana], error: null }))
  mockFrom.mockReturnValueOnce(noClasses())
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
  mockFrom.mockReturnValueOnce(chain({ data: [ana], error: null }))
  mockFrom.mockReturnValueOnce(noClasses())
  mockFrom.mockReturnValueOnce(chain({ error: { message: 'violates check constraint' } }))
  jest.spyOn(console, 'error').mockImplementation(() => {})

  const res = await dispatch(approveReq('u1'))

  expect(res.body).toEqual({ success: true })
  expect(mockSendEmail).toHaveBeenCalledTimes(1)
})

test('approving a member publishes the classes they created while waiting', async () => {
  const future = new Date(Date.now() + 86400000).toISOString()
  const live = { id: 'c1', title: 'Hangeul', class_sessions: [{ session_date: future, status: 'scheduled' }] }
  const stale = { id: 'c2', title: 'Old one', class_sessions: [{ session_date: '2026-01-01T10:00:00Z', status: 'scheduled' }] }
  const publish = chain({ error: null })
  mockFrom.mockReturnValueOnce(chain({ data: [ana], error: null }))
  mockFrom.mockReturnValueOnce(chain({ data: [live, stale], error: null }))
  mockFrom.mockReturnValueOnce(publish)
  mockFrom.mockReturnValueOnce(chain({ error: null }))

  const res = await dispatch(approveReq('u1'))

  expect(res.body).toEqual({ success: true })
  expect(publish.update).toHaveBeenCalledWith({ status: 'approved' })
  expect(publish.in).toHaveBeenCalledWith('id', ['c1', 'c2'])
  // Only the class students can still join is announced as live.
  const { text } = mockSendEmail.mock.calls[0][0]
  expect(text).toContain("'Hangeul' is now live")
  expect(text).not.toContain('Old one')
  expect(mockNotifyClassAlerts).toHaveBeenCalledTimes(1)
  expect(mockNotifyClassAlerts).toHaveBeenCalledWith(live)
})

// The university path must not undo an admin's rejection, which is recorded
// in approval_reason.
test('automatic approval only applies to members nobody has rejected', async () => {
  const users = chain({ data: [], error: null })
  mockFrom.mockReturnValueOnce(users)

  const result = await approveMember('u1', { auto: true })

  expect(users.is).toHaveBeenCalledWith('approval_reason', null)
  expect(users.update).toHaveBeenCalledWith({ is_approved: true, approval_reason: 'Verified university email' })
  expect(result.user).toBeNull()
  expect(mockSendEmail).not.toHaveBeenCalled()
})
