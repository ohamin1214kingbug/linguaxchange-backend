const { cancellationNotice } = require('../utils/cancellationNotice')

const base = { title: 'Korean for beginners', firstName: '경훈' }

describe('cancellationNotice', () => {
  test('a teacher cancelling their own class says so', () => {
    expect(cancellationNotice(base)).toContain('cancelled by the teacher')
  })

  // The teacher did not cancel anything — the platform did, because they
  // were suspended. Saying otherwise is a false statement about a person.
  test('a platform cancellation does not blame the teacher', () => {
    expect(cancellationNotice({ ...base, byPlatform: true })).not.toContain('by the teacher')
  })

  // The student is not entitled to know that someone was suspended, or
  // reported, or why. That is moderation information about another member.
  test('a platform cancellation reveals no reason at all', () => {
    const text = cancellationNotice({ ...base, byPlatform: true }).toLowerCase()
    for (const leak of ['suspend', 'report', 'ban', 'violat', 'moderat', 'account']) {
      expect(text).not.toContain(leak)
    }
  })

  test('both wordings confirm the refund, which is the part that matters', () => {
    expect(cancellationNotice(base)).toMatch(/refunded/)
    expect(cancellationNotice({ ...base, byPlatform: true })).toMatch(/refunded/)
  })

  test('both name the class, so a student with several knows which', () => {
    expect(cancellationNotice(base)).toContain(base.title)
    expect(cancellationNotice({ ...base, byPlatform: true })).toContain(base.title)
  })

  test('a missing first name does not render "Hi undefined"', () => {
    for (const byPlatform of [false, true]) {
      expect(cancellationNotice({ title: 'X', firstName: undefined, byPlatform })).not.toContain('undefined')
    }
  })
})
