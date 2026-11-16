const { extendedExpiry, requestChatAccess } = require('../utils/requestChat')

const created = '2026-11-16T10:00:00Z'
const at = iso => new Date(iso)

describe('extendedExpiry (the paused refund clock)', () => {
  test('an offer keeps the request open 24 hours from now', () => {
    expect(extendedExpiry({ expiresAt: '2026-11-17T10:00:00Z', createdAt: created, now: at('2026-11-17T08:00:00Z') }).toISOString())
      .toBe('2026-11-18T08:00:00.000Z')
  })
  test('never past 72 hours after posting', () => {
    expect(extendedExpiry({ expiresAt: '2026-11-18T20:00:00Z', createdAt: created, now: at('2026-11-19T00:00:00Z') }).toISOString())
      .toBe('2026-11-19T10:00:00.000Z')
  })
  test('never shortens what is already there', () => {
    expect(extendedExpiry({ expiresAt: '2026-11-17T10:00:00Z', createdAt: created, now: at('2026-11-16T09:00:00Z') }).toISOString())
      .toBe('2026-11-17T10:00:00.000Z')
  })
})

describe('requestChatAccess', () => {
  const request = { student_id: 1, expires_at: '2026-11-17T10:00:00Z', fulfilled_class_id: null }
  const now = at('2026-11-16T12:00:00Z')
  test('requester, +1s and offering teachers may use it; others may not', () => {
    expect(requestChatAccess({ userId: 1, request, now }).open).toBe(true)
    expect(requestChatAccess({ userId: 2, request, interestedIds: [2], now }).open).toBe(true)
    expect(requestChatAccess({ userId: 3, request, teacherIds: [3], now })).toMatchObject({ open: true, isTeacher: true })
    expect(requestChatAccess({ userId: 9, request, now }).allowed).toBe(false)
  })
  test('closes once a class answers it or it expires', () => {
    expect(requestChatAccess({ userId: 1, request: { ...request, fulfilled_class_id: 5 }, now }).open).toBe(false)
    expect(requestChatAccess({ userId: 1, request, now: at('2026-11-17T10:00:01Z') }).open).toBe(false)
  })
})

jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
const { offerEmail } = require('../routes/requestChat')

test('the offer email names the teacher and links to the chat', () => {
  const e = offerEmail({ firstName: 'Jiwoo', teacherName: 'Hamin', topic: 'Kpop terms', requestId: 7 })
  expect(e.subject).toBe('Hamin wants to teach your request: Kpop terms')
  expect(e.text).toContain('Hi Jiwoo, Hamin would like to teach "Kpop terms".')
  expect(e.text).toContain('https://gongbuleng.com/chat/request/7')
})
