jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
const { canView } = require('../routes/assignments')

const open = { student_id: 1, assignment_feedback: [] }
const answered = { student_id: 1, assignment_feedback: [{ reviewer_id: 2 }] }

test('an unanswered request is open to everyone, signed in or not', () => {
  expect(canView(open, undefined)).toBe(true)
  expect(canView(open, 3)).toBe(true)
})

test('an answered request: only the student, the reviewer who answered and the admin', () => {
  expect(canView(answered, 1)).toBe(true)
  expect(canView(answered, 2)).toBe(true)
  expect(canView(answered, 3)).toBe(false)
  expect(canView(answered, undefined)).toBe(false)
  expect(canView(answered, 3, true)).toBe(true)
})
