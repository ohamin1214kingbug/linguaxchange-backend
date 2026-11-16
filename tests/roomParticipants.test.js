jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
const { roomParticipants } = require('../routes/video')

const teacher = { id: 1, first_name: 'Hamin', last_name: 'Oh' }
const enrolled = [
  { status: 'confirmed', users: { id: 2, first_name: 'Ana', last_name: 'G', learn_details: { KO: { level: 'A2', note: 'slang please' } } } },
  { status: 'cancelled', users: { id: 3, first_name: 'Gone', last_name: 'X', learn_details: {} } },
  { status: 'attended', users: { id: 4, first_name: 'Lucas', last_name: 'M', learn_details: {} } },
]

test('the teacher sees each student with their level and note, nobody who cancelled', () => {
  const people = roomParticipants({ teacher, enrolled, isTeacher: true, userId: 1 })
  expect(people.map(p => p.id)).toEqual([2, 4])
  expect(people[0].learn_details.KO.level).toBe('A2')
})

// Classmates are told who is in the class, not what someone wrote about
// their own level.
test('a student sees the teacher and classmates by name only', () => {
  const people = roomParticipants({ teacher, enrolled, isTeacher: false, userId: 4 })
  expect(people.map(p => [p.id, p.role])).toEqual([[1, 'teacher'], [2, 'student']])
  expect(people.some(p => 'learn_details' in p)).toBe(false)
})
