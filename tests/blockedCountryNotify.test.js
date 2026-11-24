process.env.ADMIN_EMAILS = 'admin@example.com'
const sent = []
jest.mock('../utils/mailer', () => ({ sendEmail: async msg => { sent.push(msg) } }))
const { notifyAdminsOfBlockedCountry } = require('../utils/adminNotify')

test('the admin hears about a blocked country once per person, with how to fix it', async () => {
  expect(await notifyAdminsOfBlockedCountry({ country: 'CZ', email: 'ana@example.com', method: 'google', key: 'ana@example.com' })).toBe(true)
  expect(sent).toHaveLength(1)
  expect(sent[0].subject).toBe("📵 Someone couldn't get a phone code: Czechia (CZ)")
  expect(sent[0].text).toContain('ana@example.com')
  expect(sent[0].text).toContain('Geo Permissions → Czechia')
  expect(sent[0].text).toContain('mailto:ana@example.com')

  // Same person again: no second email.
  expect(await notifyAdminsOfBlockedCountry({ country: 'CZ', email: 'ana@example.com', key: 'ana@example.com' })).toBe(false)
  expect(sent).toHaveLength(1)
})

test('at most 10 a day, so fake sign-ups cannot flood the inbox', async () => {
  for (let i = 0; i < 15; i++) await notifyAdminsOfBlockedCountry({ country: 'NG', key: `+23480000000${i}` })
  expect(sent).toHaveLength(10) // 1 from the first test + 9 more
  expect(sent[1].text).toContain('not given') // no email, no reply button
  expect(sent[1].text).not.toContain('mailto:')
})
