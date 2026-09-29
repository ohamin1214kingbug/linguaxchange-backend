const { isRecipient, pendingRecipients, renderEmail } = require('../scripts/announceRename')

const now = new Date('2026-10-01T12:00:00Z')
const member = (over = {}) => ({
  id: 1, email: 'ana@example.com', first_name: 'Ana',
  is_approved: true, deleted_at: null, suspended_until: null, ...over,
})

describe('isRecipient', () => {
  test('an approved, active member gets the email', () => {
    expect(isRecipient(member(), now)).toBe(true)
  })

  test('pending, deleted and address-less accounts do not', () => {
    expect(isRecipient(member({ is_approved: false }), now)).toBe(false)
    expect(isRecipient(member({ deleted_at: '2026-09-01T00:00:00Z' }), now)).toBe(false)
    expect(isRecipient(member({ email: null }), now)).toBe(false)
  })

  test('a current suspension excludes; an expired one does not', () => {
    expect(isRecipient(member({ suspended_until: '2026-10-05T00:00:00Z' }), now)).toBe(false)
    expect(isRecipient(member({ suspended_until: '2026-09-20T00:00:00Z' }), now)).toBe(true)
  })

  // Test fixtures use RFC 2606 .invalid addresses; mailing them only bounces.
  test('.invalid fixture addresses are skipped', () => {
    expect(isRecipient(member({ email: 'test-student@gongbuleng.invalid' }), now)).toBe(false)
  })
})

describe('pendingRecipients', () => {
  // The resume guarantee: a re-run after a partial send must never mail
  // someone twice.
  test('drops everyone already in the sent log', () => {
    const users = [member({ id: 1 }), member({ id: 2 }), member({ id: 3, is_approved: false })]
    expect(pendingRecipients(users, [1], now).map(u => u.id)).toEqual([2])
  })
})

describe('renderEmail', () => {
  test('greets by first name in both languages', () => {
    const { subject, text } = renderEmail('Ana')
    expect(subject).toBe('LinguaXchange is now GongbuLeng')
    expect(text).toMatch(/^Hi Ana,/)
    expect(text).toContain('Hola Ana:')
    expect(text).toContain('https://gongbuleng.com')
    expect(text).toContain('gongbuleng.team@gmail.com')
  })

  test('falls back to a bare greeting without a name', () => {
    const { text } = renderEmail(null)
    expect(text).toMatch(/^Hi,/)
    expect(text).toContain('Hola:')
    expect(text).not.toContain('null')
  })
})
