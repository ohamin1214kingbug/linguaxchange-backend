jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
const { tandemMatches, openPeople, tandemRole, cleanHello } = require('../utils/tandem')
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

describe('temporary chats', () => {
  const { agreeWindowEnd, afterCallEnd, tandemChatOpen, groupChatOpen } = require('../utils/tandem')
  const NOW = new Date('2026-11-19T12:00:00Z')

  test('a hello accepted now leaves 2 days to agree a time', () => {
    expect(agreeWindowEnd(NOW).toISOString()).toBe('2026-11-21T12:00:00.000Z')
  })

  test('an agreed call keeps the chat open until 1 day after a 60-minute call ends', () => {
    expect(afterCallEnd('2026-11-20T19:00:00Z').toISOString()).toBe('2026-11-21T20:00:00.000Z')
  })

  test('the 1-to-1 chat is open only while accepted and before chat_open_until', () => {
    const until = '2026-11-21T12:00:00Z'
    expect(tandemChatOpen({ status: 'accepted', chat_open_until: until }, NOW)).toBe(true)
    expect(tandemChatOpen({ status: 'accepted', chat_open_until: until }, new Date('2026-11-21T12:00:01Z'))).toBe(false)
    expect(tandemChatOpen({ status: 'ended', chat_open_until: until }, NOW)).toBe(false)
    expect(tandemChatOpen({ status: 'accepted', chat_open_until: null }, NOW)).toBe(false)
  })

  test('a group chat closes 1 day after its call ends, or at once when cancelled', () => {
    const g = { starts_at: '2026-11-20T19:00:00Z', duration_minutes: 90 }
    expect(groupChatOpen(g, new Date('2026-11-21T20:29:00Z'))).toBe(true)
    expect(groupChatOpen(g, new Date('2026-11-21T20:31:00Z'))).toBe(false)
    expect(groupChatOpen({ ...g, cancelled_at: '2026-11-19T10:00:00Z' }, NOW)).toBe(false)
  })
})

describe('tandem groups', () => {
  const { validateGroup, groupSide } = require('../utils/tandem')
  const { groupView } = require('../routes/tandemGroups')
  const NOW = new Date('2026-11-19T12:00:00Z')
  const ok = { lang_a: 'ko', lang_b: 'ES', starts_at: '2026-11-20T19:00:00Z', duration_minutes: 60, size: 4, topic: '  Food  ' }

  test('validateGroup normalises a good group and refuses bad ones', () => {
    const v = validateGroup(ok, NOW)
    expect(v.ok).toBe(true)
    expect(v.group).toMatchObject({ lang_a: 'KO', lang_b: 'ES', size: 4, duration_minutes: 60, topic: 'Food' })
    expect(validateGroup({ ...ok, lang_b: 'KO' }, NOW).ok).toBe(false)
    expect(validateGroup({ ...ok, lang_a: 'JA' }, NOW).ok).toBe(false)
    expect(validateGroup({ ...ok, starts_at: '2026-11-19T11:00:00Z' }, NOW).ok).toBe(false)
    expect(validateGroup({ ...ok, starts_at: '2027-02-01T11:00:00Z' }, NOW).ok).toBe(false)
    expect(validateGroup({ ...ok, size: 5 }, NOW).ok).toBe(false)
    expect(validateGroup({ ...ok, duration_minutes: 30 }, NOW).ok).toBe(false)
    expect(validateGroup({ ...ok, topic: 'x'.repeat(121) }, NOW).ok).toBe(false)
  })

  test('you join on the side of the language you teach', () => {
    const g = { lang_a: 'KO', lang_b: 'ES' }
    expect(groupSide(g, 'KO')).toBe('a')
    expect(groupSide(g, 'ES')).toBe('b')
    expect(groupSide(g, 'DE')).toBeNull()
    expect(groupSide(g, '')).toBeNull()
  })

  test('groupView: a full side cannot be joined; members see the chat', () => {
    const group = { id: 1, host_id: 10, lang_a: 'KO', lang_b: 'ES', starts_at: '2099-01-01T19:00:00Z', duration_minutes: 60, size: 4 }
    const members = [
      { user_id: 10, side: 'a', users: { first_name: 'Hamin' } },
      { user_id: 11, side: 'b', users: { first_name: 'Ana' } },
      { user_id: 12, side: 'b', users: { first_name: 'Luis' } },
    ]
    const spanish = groupView(group, members, { id: 13, teach_language: 'ES' })
    expect(spanish).toMatchObject({ my_side: 'b', full: true, can_join: false, joined: false, host_first_name: 'Hamin' })
    const korean = groupView(group, members, { id: 14, teach_language: 'KO' })
    expect(korean).toMatchObject({ my_side: 'a', full: false, can_join: true })
    const german = groupView(group, members, { id: 15, teach_language: 'DE' })
    expect(german.can_join).toBe(false)
    const host = groupView(group, members, { id: 10, teach_language: 'KO' })
    expect(host).toMatchObject({ joined: true, is_host: true, chat_open: true, can_join: false })
  })
})

test('tandem alerts skip the sender, live partners and anyone alerted today', () => {
  jest.isolateModules(() => {
    jest.doMock('../utils/push', () => ({ pushNotifications: () => {} }))
    const { alertRecipients } = require('../utils/tandemAlerts')
    expect(alertRecipients([1, 2, 3, 4, 4, 5], { senderId: 1, excludeIds: [2], alertedToday: [3] })).toEqual([4, 5])
  })
})

describe('openPeople', () => {
  test('lists everyone who teaches something, perfect first, then for me, then the rest; flags live tandems', () => {
    const others = [
      { id: 2, teach_language: 'fr', learn_languages: ['ko'] },   // teaches nothing I learn: still listed
      { id: 3, teach_language: 'es', learn_languages: ['fr'] },   // for me, one way
      { id: 4, teach_language: 'de', learn_languages: ['ko'] },   // perfect
      { id: 5, teach_language: ' ', learn_languages: ['ko'] },    // teaches nothing: left out
      { id: 1, teach_language: 'es', learn_languages: ['ko'] },   // me
    ]
    const p = openPeople(me, others, new Set([3]))
    expect(p.map(u => [u.id, u.perfect, u.forMe, u.live])).toEqual([[4, true, true, false], [3, false, true, true], [2, false, false, false]])
  })
})
