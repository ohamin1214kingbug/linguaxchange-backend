// "Tell me when a Korean A2 class is posted": who gets mailed when a class
// goes live, and what the alert may hold.

const mockFrom = jest.fn()
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args) => mockFrom(...args) }),
}))
const mockSendEmail = jest.fn()
jest.mock('../utils/mailer', () => ({ sendEmail: (...args) => mockSendEmail(...args) }))

const { validateAlert, buildAlertEmail, notifyClassAlerts } = require('../utils/classAlerts')

function chain(result) {
  const builder = {}
  ;['select', 'eq', 'in'].forEach((m) => { builder[m] = jest.fn(() => builder) })
  builder.then = (resolve) => resolve(result)
  return builder
}

const cls = { id: 7, teacher_id: 1, language_code: 'KO', level: 'A2', title: 'Ordering food' }

beforeEach(() => {
  jest.resetAllMocks()
  mockSendEmail.mockResolvedValue({ ok: true })
})

describe('validateAlert', () => {
  test('a language with or without a level is fine', () => {
    expect(validateAlert({ language_code: 'KO', level: '' })).toBeNull()
    expect(validateAlert({ language_code: 'KO', level: 'A2' })).toBeNull()
  })

  test('unknown languages and levels are refused', () => {
    expect(validateAlert({ language_code: 'XX', level: '' })).toMatch(/language/)
    expect(validateAlert({ language_code: 'KO', level: 'Native' })).toMatch(/level/)
  })
})

test('the email links to the browse page filtered to that class', () => {
  const { subject, text } = buildAlertEmail(cls, 'Ana')
  expect(subject).toBe('New Korean A2 class: Ordering food')
  expect(text).toContain('https://gongbuleng.com/classes?language=KO&level=A2')
})

test('mails each follower once, never the teacher or a deleted account', async () => {
  const alerts = chain({
    data: [
      { user_id: 2, users: { email: 'ana@ucm.es', first_name: 'Ana' } },
      { user_id: 2, users: { email: 'ana@ucm.es', first_name: 'Ana' } }, // follows "Korean" and "Korean A2"
      { user_id: 1, users: { email: 'teacher@ucm.es', first_name: 'Min' } },
      { user_id: 3, users: { email: 'gone@ucm.es', first_name: 'X', deleted_at: '2026-10-01' } },
    ],
    error: null,
  })
  mockFrom.mockReturnValueOnce(alerts)

  const sent = await notifyClassAlerts(cls)

  expect(sent).toBe(1)
  expect(mockSendEmail).toHaveBeenCalledTimes(1)
  expect(mockSendEmail.mock.calls[0][0].to).toBe('ana@ucm.es')
  expect(alerts.in).toHaveBeenCalledWith('level', ['', 'A2'])
})

test('a read failure is logged and sends nothing, without throwing', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
  mockFrom.mockReturnValueOnce(chain({ data: null, error: { message: 'relation "class_alerts" does not exist' } }))

  await expect(notifyClassAlerts(cls)).resolves.toBe(0)
  expect(mockSendEmail).not.toHaveBeenCalled()
  expect(spy).toHaveBeenCalledWith('[CLASS_ALERT] Could not read alerts:', expect.any(String))
  spy.mockRestore()
})
