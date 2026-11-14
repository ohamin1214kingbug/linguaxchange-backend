jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
const { requestAnsweredEmail } = require('../routes/classRequests')

test('tells an enrolled requester they are already in', () => {
  const e = requestAnsweredEmail({ firstName: 'Ana', topic: 'Kpop terms', title: 'Kpop Terms', when: 'Nov 20, 2026, 7:00 PM', enrolled: true, classId: 9 })
  expect(e.subject).toBe('A teacher answered your request: Kpop terms')
  expect(e.text).toContain('You are already in the class')
  expect(e.text).toContain('Starts: Nov 20, 2026, 7:00 PM')
  expect(e.text).toContain('https://gongbuleng.com/classes/9')
})

// If the class was full or the enrolment failed, the student must not be
// told they are in.
test('asks them to join when they could not be enrolled', () => {
  const e = requestAnsweredEmail({ firstName: null, topic: 'Food', title: 'Food talk', when: null, enrolled: false, classId: 3 })
  expect(e.text).toContain('Join it')
  expect(e.text).not.toContain('already in')
  expect(e.text).not.toContain('Starts:')
})
