const { buildInbox } = require('../utils/chatInbox')

const now = new Date('2026-11-16T12:00:00Z')
const cls = (id, teacher_id) => ({ id, title: `Class ${id}`, teacher_id, duration_minutes: 60 })

describe('buildInbox', () => {
  test('lists open chats, newest message first, then by date; drops closed ones', () => {
    const sessions = [
      { id: 1, session_date: '2026-11-17T10:00:00Z', status: 'scheduled', classes: cls(10, 5) }, // teaching, no messages
      { id: 2, session_date: '2026-11-18T10:00:00Z', status: 'scheduled', classes: cls(11, 9), enrollmentStatus: 'confirmed' },
      { id: 3, session_date: '2026-11-10T10:00:00Z', status: 'completed', classes: cls(12, 9), enrollmentStatus: 'confirmed' }, // closed
      { id: 4, session_date: '2026-11-18T10:00:00Z', status: 'scheduled', classes: cls(13, 9), enrollmentStatus: 'cancelled' }, // cancelled with the class: stays (owner, 2026-11-27)
    ]
    const requests = [
      { id: 7, topic: 'Korean', student_id: 5, expires_at: '2026-11-17T00:00:00Z', fulfilled_class_id: null },
      { id: 8, topic: 'Done', student_id: 5, expires_at: '2026-11-17T00:00:00Z', fulfilled_class_id: 99 },
    ]
    const messages = [ // newest first, as the route loads them
      { id: 30, thread_type: 'request', thread_id: 7, body: 'Thu?', user_id: 9, users: { first_name: 'Minji' }, proposed_time: '2026-11-20T17:00:00Z' },
      { id: 20, thread_type: 'session', thread_id: 2, body: 'Hi', user_id: 5, users: { first_name: 'Me' } },
      { id: 10, thread_type: 'request', thread_id: 7, body: 'older', user_id: 5 },
    ]
    const inbox = buildInbox({ userId: 5, sessions, requests, messages, now })
    expect(inbox.map(i => `${i.type}:${i.id}`)).toEqual(['request:7', 'session:2', 'session:1', 'session:4'])
    expect(inbox[0].last).toMatchObject({ id: 30, first_name: 'Minji', mine: false, proposed_time: '2026-11-20T17:00:00Z' })
    expect(inbox[0].is_requester).toBe(true)
    expect(inbox[1].last.mine).toBe(true)
    expect(inbox[2]).toMatchObject({ is_teacher: true, last: null, href: '/chat/1' })
  })
})
