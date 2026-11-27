const { sealReply, openReply, TTL_MS } = require('../utils/replyToken')

const secret = 'test-secret'
const data = { email: 'ana@example.com', country: 'ZA', method: 'google' }

test('opens what it sealed, and the email is not readable in the token', () => {
  const t = sealReply(data, { secret })
  expect(t).not.toContain('ana')
  expect(Buffer.from(t, 'base64url').toString('latin1')).not.toContain('ana@')
  expect(openReply(t, { secret })).toMatchObject(data)
})

test('refuses expired, tampered, wrong-key and junk tokens', () => {
  const now = Date.now()
  const t = sealReply(data, { secret, now })
  expect(openReply(t, { secret, now: now + TTL_MS + 1 })).toBeNull()
  const flipped = Buffer.from(t, 'base64url'); flipped[flipped.length - 1] ^= 1
  expect(openReply(flipped.toString('base64url'), { secret })).toBeNull()
  expect(openReply(t, { secret: 'other' })).toBeNull()
  expect(openReply('nonsense', { secret })).toBeNull()
  expect(openReply(undefined, { secret })).toBeNull()
})
