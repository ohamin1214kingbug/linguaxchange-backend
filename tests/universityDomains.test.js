const { matchDomain } = require('../utils/universityDomains')

const allowlist = [
  { domain: 'ucm.es', name: 'Universidad Complutense de Madrid' },
  { domain: 'estudiantes.ucm.es', name: 'Universidad Complutense de Madrid (estudiantes)' },
]

describe('matchDomain', () => {
  test('matches a listed domain', () => {
    expect(matchDomain('hamin@ucm.es', allowlist).name).toBe('Universidad Complutense de Madrid')
  })

  test('is case-insensitive across the whole address', () => {
    expect(matchDomain('Student@UCM.ES', allowlist)?.domain).toBe('ucm.es')
    expect(matchDomain('STUDENT@Ucm.Es', allowlist)?.domain).toBe('ucm.es')
  })

  test('rejects a domain that merely ends with a listed one', () => {
    // The whole reason this is equality and not endsWith: evil.com controls
    // this address, and accepting it would issue a badge saying the holder
    // studies at Complutense.
    expect(matchDomain('attacker@ucm.es.evil.com', allowlist)).toBe(null)
    expect(matchDomain('attacker@notucm.es', allowlist)).toBe(null)
  })

  test('treats a subdomain as its own entry', () => {
    expect(matchDomain('a@estudiantes.ucm.es', allowlist)?.domain).toBe('estudiantes.ucm.es')
    expect(matchDomain('a@alumnos.ucm.es', allowlist)).toBe(null)
  })

  test('splits on the last @ so a quoted local part cannot spoof the domain', () => {
    expect(matchDomain('"weird@ucm.es"@evil.com', allowlist)).toBe(null)
  })

  test('rejects malformed input without throwing', () => {
    for (const bad of ['', 'no-at-sign', '@ucm.es', 'name@', null, undefined, 42, {}]) {
      expect(matchDomain(bad, allowlist)).toBe(null)
    }
  })

  test('rejects everything when the allowlist is empty or missing', () => {
    expect(matchDomain('hamin@ucm.es', [])).toBe(null)
    expect(matchDomain('hamin@ucm.es', undefined)).toBe(null)
  })

  test('rejects control characters and internal whitespace', () => {
    // The matched string is handed to the mailer, so a header-style payload
    // must not survive matching even though its domain really is listed.
    expect(matchDomain('a\r\nBcc: evil@x.com@ucm.es', allowlist)).toBe(null)
    expect(matchDomain('a b@ucm.es', allowlist)).toBe(null)
    expect(matchDomain('a\u0000@ucm.es', allowlist)).toBe(null)
  })

  test('trims surrounding whitespace', () => {
    expect(matchDomain('  hamin@ucm.es  ', allowlist)?.domain).toBe('ucm.es')
  })
})
