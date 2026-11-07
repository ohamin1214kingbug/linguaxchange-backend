// A new class request emails the members who teach that language, in their
// own time zone, unless they turned it off.

const mockFrom = jest.fn()
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args) => mockFrom(...args) }),
}))
const mockSendEmail = jest.fn()
jest.mock('../utils/mailer', () => ({ sendEmail: (...args) => mockSendEmail(...args) }))

const { wantsRequestEmails, buildRequestEmail, notifyTeachersOfRequest } = require('../utils/requestAlerts')

function chain(result) {
  const builder = {}
  ;['select', 'eq', 'is', 'neq'].forEach((m) => { builder[m] = jest.fn(() => builder) })
  builder.then = (resolve) => resolve(result)
  return builder
}

const request = {
  student_id: 2, language_code: 'KO', level: 'A2', topic: 'Ordering food',
  preferred_time: '2026-11-10T18:00:00Z', time_flexible: true,
}

beforeEach(() => {
  jest.resetAllMocks()
  mockSendEmail.mockResolvedValue({ ok: true })
})

test('on by default, off only when switched off', () => {
  expect(wantsRequestEmails(undefined)).toBe(true)
  expect(wantsRequestEmails({ low_credit_nudge: true })).toBe(true)
  expect(wantsRequestEmails({ request_emails: false })).toBe(false)
})

test('the time is in the teacher\'s zone and the link opens the request board', () => {
  const { subject, text } = buildRequestEmail(request, { first_name: 'Min', timezone: 'Asia/Seoul' })
  expect(subject).toBe('A student wants a Korean A2 class: Ordering food')
  expect(text).toContain('Nov 11, 2026, 3:00 AM (flexible)')
  expect(text).toContain('https://gongbuleng.com/classes?tab=requests&language=KO')
})

test('mails teachers of the language except those who opted out, never the student', async () => {
  const teachers = chain({
    data: [
      { id: 1, email: 'min@ucm.es', first_name: 'Min', timezone: 'Europe/Madrid' },
      { id: 3, email: 'off@ucm.es', first_name: 'Off', notification_preferences: { request_emails: false } },
    ],
    error: null,
  })
  mockFrom.mockReturnValueOnce(teachers)

  await expect(notifyTeachersOfRequest(request)).resolves.toBe(1)
  expect(mockSendEmail.mock.calls[0][0].to).toBe('min@ucm.es')
  expect(teachers.eq).toHaveBeenCalledWith('teach_language', 'KO')
  expect(teachers.neq).toHaveBeenCalledWith('id', 2)
})

test('a read failure sends nothing and does not throw', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
  mockFrom.mockReturnValueOnce(chain({ data: null, error: { message: 'boom' } }))
  await expect(notifyTeachersOfRequest(request)).resolves.toBe(0)
  expect(mockSendEmail).not.toHaveBeenCalled()
  spy.mockRestore()
})
