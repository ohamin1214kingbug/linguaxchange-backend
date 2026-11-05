// Members on one network (UCM Wi-Fi) share an address, so the tight limits
// are keyed on the account or phone a request is for. These run the real
// limiters in a small Express app: one classmate's failed logins or code
// requests must not block another on the same address.

const express = require('express')
const { loginLimiter, otpSendLimiter, accountKey } = require('../middleware/rateLimit')

let server, base
beforeAll(done => {
  const app = express()
  app.set('trust proxy', 2)
  app.use(express.json())
  // ?ok=1 answers 200, anything else 401, like a right or wrong password.
  app.post('/login', loginLimiter, (req, res) => res.status(req.query.ok ? 200 : 401).end())
  app.post('/send-otp', otpSendLimiter, (req, res) => res.status(200).end())
  server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; done() })
})
afterAll(done => { server.close(done) })

const post = (path, body) => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(r => r.status)

test('failed logins lock that account only, not classmates on the same network', async () => {
  for (let i = 0; i < 10; i++) expect(await post('/login', { email: 'a@ucm.es' })).toBe(401)
  expect(await post('/login', { email: 'A@ucm.es ' })).toBe(429)
  expect(await post('/login', { email: 'b@ucm.es' })).toBe(401)
})

test('successful logins never use up the limit', async () => {
  for (let i = 0; i < 15; i++) expect(await post('/login?ok=1', { email: 'c@ucm.es' })).toBe(200)
})

test('verification codes are capped per phone, not per network', async () => {
  for (let i = 0; i < 3; i++) expect(await post('/send-otp', { phone_number: '+34600000001' })).toBe(200)
  expect(await post('/send-otp', { phone_number: '+34 600 000 001' })).toBe(429)
  expect(await post('/send-otp', { phone_number: '+34600000002' })).toBe(200)
})

test('a signed-in request without an email is keyed on the member', () => {
  const req = { ip: '1.2.3.4', body: {}, userId: 'u1', get: () => undefined }
  expect(accountKey(req)).toBe('1.2.3.4|u1')
})
