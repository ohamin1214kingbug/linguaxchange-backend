jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
const { tandemMatches, tandemRole, cleanHello } = require('../utils/tandem')
const { helloEmail } = require('../routes/tandems')

const me = { id: 1, teach_language: 'ko', learn_languages: ['es', 'de'] }

describe('tandemMatches', () => {
  test('perfect matches first, then one-way; nobody who teaches nothing I learn', () => {
    const others = [
      { id: 2, teach_language: 'es', learn_languages: ['fr'] },   // one-way
      { id: 3, teach_language: 'de', learn_languages: ['ko'] },   // perfect
      { id: 4, teach_language: 'fr', learn_languages: ['ko'] },   // teaches nothing I learn
      { id: 5, teach_language: '', learn_languages: ['ko'] },     // blank teaching language
      { id: 1, teach_language: 'es', learn_languages: ['ko'] },   // me
    ]
    const m = tandemMatches(me, others)
    expect(m.map(u => [u.id, u.perfect])).toEqual([[3, true], [2, false]])
  })

  test('shared survey times break ties within a group', () => {
    const others = [
      { id: 2, teach_language: 'es', learn_languages: ['ko'] },
      { id: 3, teach_language: 'de', learn_languages: ['ko'] },
    ]
    const times = { 1: ['evening', 'weekend'], 2: ['morning'], 3: ['weekend'] }
    expect(tandemMatches(me, others, { times }).map(u => u.id)).toEqual([3, 2])
  })

  test('a member with no teaching language gets only one-way matches', () => {
    const m = tandemMatches({ id: 9, learn_languages: ['es'] }, [{ id: 2, teach_language: 'es', learn_languages: [''] }])
    expect(m).toHaveLength(1)
    expect(m[0].perfect).toBe(false)
  })
})

test('tandemRole: only the two members have a role', () => {
  const t = { requester_id: 1, partner_id: 2 }
  expect(tandemRole(t, 1)).toBe('requester')
  expect(tandemRole(t, 2)).toBe('partner')
  expect(tandemRole(t, 3)).toBeNull()
  expect(tandemRole(null, 1)).toBeNull()
})

test('cleanHello trims and caps at 300 characters', () => {
  expect(cleanHello('  hi!  ')).toBe('hi!')
  expect(cleanHello('   ')).toBeNull()
  expect(cleanHello('x'.repeat(301))).toBeNull()
  expect(cleanHello(5)).toBeNull()
})

test('the hello email names the sender, quotes the hello and links to the tandem page', () => {
  const e = helloEmail({ firstName: 'Jiwoo', fromName: 'Hamin', message: 'Hola! I teach Korean.' })
  expect(e.subject).toBe('Hamin wants to be your tandem partner on GongbuLeng')
  expect(e.text).toContain('Hola! I teach Korean.')
  expect(e.text).toContain('https://gongbuleng.com/tandem')
})
