const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { buildJaasToken, normalizeKey } = require('../utils/jaasToken')

// Self-contained throwaway keypair - no fixture files, no real credentials.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
})

const base = {
  appId: 'vpaas-magic-cookie-test',
  kid: 'vpaas-magic-cookie-test/abc123',
  privateKey,
  room: 'linguaxchange-42-deadbeefdeadbeef',
  userId: 7,
  displayName: 'Hamin Oh',
  now: 1785000000000
}

// Verify as of the token's own issuing instant, so this fixed `now` doesn't
// start failing once real time drifts past the 2h expiry.
const verifyOpts = { algorithms: ['RS256'], clockTimestamp: base.now / 1000 }

describe('buildJaasToken', () => {
  test('produces a token 8x8 can verify, with the claims JaaS requires', () => {
    const payload = jwt.verify(buildJaasToken({ ...base, isModerator: true }), publicKey, verifyOpts)

    expect(payload.aud).toBe('jitsi')
    expect(payload.iss).toBe('chat')
    expect(payload.sub).toBe(base.appId)
    expect(payload.room).toBe(base.room) // bare name, not AppID-prefixed
    expect(payload.context.user.name).toBe('Hamin Oh')
    expect(payload.context.user.id).toBe('7')
  })

  test('carries the kid header 8x8 uses to pick the verifying key', () => {
    const { header } = jwt.decode(buildJaasToken({ ...base, isModerator: true }), { complete: true })
    expect(header.alg).toBe('RS256')
    expect(header.kid).toBe(base.kid)
  })

  // The bug this whole change exists to fix: without a moderator the room
  // never starts and everyone sits on "no moderators have yet arrived".
  test('marks the teacher a moderator and students not', () => {
    const teacher = jwt.decode(buildJaasToken({ ...base, isModerator: true }))
    const student = jwt.decode(buildJaasToken({ ...base, isModerator: false }))

    expect(teacher.context.user.moderator).toBe('true')
    expect(student.context.user.moderator).toBe('false')
  })

  test('leaves every billable add-on switched off', () => {
    const { context } = jwt.decode(buildJaasToken({ ...base, isModerator: true }))
    expect(Object.values(context.features).every(v => v === false)).toBe(true)
  })

  test('is valid now and expires within the plan-safe window', () => {
    const nowSec = base.now / 1000
    const payload = jwt.decode(buildJaasToken({ ...base, isModerator: false }))

    expect(payload.nbf).toBeLessThanOrEqual(nowSec)
    expect(payload.exp).toBeGreaterThan(nowSec)
    expect(payload.exp - nowSec).toBe(2 * 60 * 60)
  })

  test('accepts a PEM whose newlines were flattened by the host env', () => {
    const flattened = privateKey.replace(/\n/g, '\\n')
    expect(normalizeKey(flattened)).toBe(privateKey)

    // and signs with it end to end
    const token = buildJaasToken({ ...base, privateKey: flattened, isModerator: true })
    expect(() => jwt.verify(token, publicKey, verifyOpts)).not.toThrow()
  })
})
