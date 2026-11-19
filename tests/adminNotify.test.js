process.env.ADMIN_EMAILS = 'admin@example.com'
const sent = []
jest.mock('../utils/mailer', () => ({ sendEmail: async msg => { sent.push(msg) } }))
const { notifyAdminsOfFirstClass } = require('../utils/adminNotify')

test("the admin is told about a new teacher's first class, with a link to it", async () => {
  await notifyAdminsOfFirstClass(
    { first_name: 'Ana', last_name: 'López', email: 'ana@example.com' },
    { id: 42, title: 'Spanish for travel', language_code: 'ES', level: 'A1' },
  )
  expect(sent).toHaveLength(1)
  expect(sent[0].to).toBe('admin@example.com')
  expect(sent[0].subject).toBe('New teacher: Ana López posted their first class')
  expect(sent[0].text).toContain('Spanish for travel')
  expect(sent[0].text).toContain('/classes/42')
  expect(sent[0].text).toContain('already public')
})
