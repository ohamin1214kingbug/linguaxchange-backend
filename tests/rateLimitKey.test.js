// keyGenerator buckets rate limits by the visitor's address. Requests that
// come through the gongbuleng.com proxy carry the visitor's IP in
// x-client-ip, but that header is honoured only alongside the shared
// API_PROXY_SECRET; otherwise a direct caller could pick their own bucket.

const { keyGenerator } = require('../middleware/rateLimit')

function req(ip, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { ip, get: name => lower[name.toLowerCase()] }
}

const SECRET = 'a'.repeat(64)
let saved
beforeEach(() => { saved = process.env.API_PROXY_SECRET; process.env.API_PROXY_SECRET = SECRET })
afterEach(() => {
  if (saved === undefined) delete process.env.API_PROXY_SECRET
  else process.env.API_PROXY_SECRET = saved
})

test('uses the forwarded visitor IP when the proxy secret matches', () => {
  expect(keyGenerator(req('76.76.21.1', { 'x-proxy-secret': SECRET, 'x-client-ip': '147.96.10.20' }))).toBe('147.96.10.20')
})

test('ignores x-client-ip without the secret', () => {
  expect(keyGenerator(req('9.9.9.9', { 'x-client-ip': '1.1.1.1' }))).toBe('9.9.9.9')
})

test('ignores x-client-ip with a wrong secret, including one of a different length', () => {
  expect(keyGenerator(req('9.9.9.9', { 'x-proxy-secret': 'b'.repeat(64), 'x-client-ip': '1.1.1.1' }))).toBe('9.9.9.9')
  expect(keyGenerator(req('9.9.9.9', { 'x-proxy-secret': 'short', 'x-client-ip': '1.1.1.1' }))).toBe('9.9.9.9')
})

test('ignores the headers entirely when no secret is configured', () => {
  delete process.env.API_PROXY_SECRET
  expect(keyGenerator(req('9.9.9.9', { 'x-proxy-secret': '', 'x-client-ip': '1.1.1.1' }))).toBe('9.9.9.9')
})

test('groups IPv6 visitors by subnet, as express-rate-limit expects', () => {
  expect(keyGenerator(req('2001:db8::1'))).toBe('2001:db8::/56')
  expect(keyGenerator(req('76.76.21.1', { 'x-proxy-secret': SECRET, 'x-client-ip': '2001:db8::5' }))).toBe('2001:db8::/56')
})
