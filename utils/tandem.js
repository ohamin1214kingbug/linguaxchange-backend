// Tandem matching (routes/tandems.js). Pure, so the rules are tested
// without a database.
//
// A perfect match teaches a language I learn AND learns the one I teach.
// A one-way match only teaches a language I learn. Perfect matches come
// first, then one-way; within each, members who share more free times
// (survey answers) come first.
// ponytail: compares every opted-in member in memory; fine for hundreds,
// move the filter into SQL when the opted-in list gets into the thousands.

const { sharedInterests } = require('./interests')

const learns = u => (u.learn_languages || []).filter(Boolean)
const teaches = u => (u.teach_language || '').trim()

function tandemMatches(me, others, { times = {} } = {}) {
  const myTeach = teaches(me)
  const myLearn = learns(me)
  const myTimes = new Set(times[me.id] || [])
  return others
    .filter(o => o.id !== me.id && teaches(o) && myLearn.includes(teaches(o)))
    .map(o => ({
      ...o,
      perfect: Boolean(myTeach) && learns(o).includes(myTeach),
      sharedTimes: (times[o.id] || []).filter(t => myTimes.has(t)).length,
      sharedInterests: sharedInterests(me, o),
    }))
    // Shared interests right after perfect: they are what makes a stranger
    // worth a hello (owner, 2026-11-28).
    .sort((a, b) => (b.perfect - a.perfect) || (b.sharedInterests - a.sharedInterests) || (b.sharedTimes - a.sharedTimes) || (b.id - a.id))
}

// Everyone listed for a tandem, for the People page's language buttons
// (owner, 2026-11-27): unlike tandemMatches, also members who teach a
// language I don't learn. forMe = teaches a language I learn; live = we
// already have a pending or accepted tandem.
function openPeople(me, others, liveIds = new Set()) {
  const myTeach = teaches(me)
  const myLearn = learns(me)
  return others
    .filter(o => o.id !== me.id && teaches(o))
    .map(o => {
      const forMe = myLearn.includes(teaches(o))
      return { ...o, forMe, perfect: forMe && Boolean(myTeach) && learns(o).includes(myTeach), live: liveIds.has(o.id), sharedInterests: sharedInterests(me, o) }
    })
    .sort((a, b) => (b.perfect - a.perfect) || (b.forMe - a.forMe) || (b.sharedInterests - a.sharedInterests) || (b.id - a.id))
}

// Who may do what to a tandem row.
function tandemRole(tandem, userId) {
  if (!tandem) return null
  if (tandem.requester_id === userId) return 'requester'
  if (tandem.partner_id === userId) return 'partner'
  return null
}

const HELLO_MAX = 300
function cleanHello(text) {
  if (typeof text !== 'string') return null
  const t = text.trim()
  return t && t.length <= HELLO_MAX ? t : null
}

module.exports = { tandemMatches, openPeople, tandemRole, cleanHello, HELLO_MAX }

// ---- Temporary chats (owner rule, 2026-11-19), like class chats ----
// A 1-to-1 chat opens for 2 days when a hello is accepted (or on "Meet
// again") to agree a time; once a time is agreed it stays open until 1 day
// after that call ends. A group chat is open to members until 1 day after
// the group's call ends. Video rooms open 10 minutes before a call
// (utils/classroomAccess.js, as for teachers).
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const AGREE_WINDOW_MS = 2 * DAY_MS
const AFTER_CALL_MS = DAY_MS
const TANDEM_CALL_MINUTES = 60

const agreeWindowEnd = (now = new Date()) => new Date(now.getTime() + AGREE_WINDOW_MS)
const callEnd = (start, minutes) => new Date(new Date(start).getTime() + minutes * 60 * 1000)
const afterCallEnd = (start, minutes = TANDEM_CALL_MINUTES) => new Date(callEnd(start, minutes).getTime() + AFTER_CALL_MS)

function tandemChatOpen(tandem, now = new Date()) {
  return tandem?.status === 'accepted' && Boolean(tandem.chat_open_until) && now <= new Date(tandem.chat_open_until)
}

function groupChatOpen(group, now = new Date()) {
  return !group.cancelled_at && now <= afterCallEnd(group.starts_at, group.duration_minutes)
}

// ---- Tandem groups ----
const GROUP_LANGUAGES = ['KO', 'ES', 'DE', 'EN', 'PT', 'FR', 'IT']
const GROUP_DURATIONS = [45, 60, 90]
const GROUP_SIZES = [4, 6, 8]
const GROUP_MAX_AHEAD_MS = 60 * DAY_MS

// The side a member speaks in a group: the group language they teach.
function groupSide(group, teachLanguage) {
  const lang = (teachLanguage || '').trim()
  if (lang && lang === group.lang_a) return 'a'
  if (lang && lang === group.lang_b) return 'b'
  return null
}

function validateGroup(body = {}, now = new Date()) {
  const lang_a = String(body.lang_a || '').toUpperCase()
  const lang_b = String(body.lang_b || '').toUpperCase()
  if (!GROUP_LANGUAGES.includes(lang_a) || !GROUP_LANGUAGES.includes(lang_b) || lang_a === lang_b) return { ok: false, error: 'Pick two different languages' }
  const starts = new Date(body.starts_at)
  if (isNaN(starts) || starts <= now) return { ok: false, error: 'Pick a time in the future' }
  if (starts.getTime() - now.getTime() > GROUP_MAX_AHEAD_MS) return { ok: false, error: 'Pick a time in the next 60 days' }
  const duration_minutes = Number(body.duration_minutes)
  if (!GROUP_DURATIONS.includes(duration_minutes)) return { ok: false, error: 'Pick 45, 60 or 90 minutes' }
  const size = Number(body.size)
  if (!GROUP_SIZES.includes(size)) return { ok: false, error: 'Pick 4, 6 or 8 people' }
  const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
  if (topic.length > 120) return { ok: false, error: 'Keep the topic under 120 characters' }
  return { ok: true, group: { lang_a, lang_b, starts_at: starts.toISOString(), duration_minutes, size, topic: topic || null } }
}

module.exports = {
  ...module.exports,
  AGREE_WINDOW_MS, AFTER_CALL_MS, TANDEM_CALL_MINUTES,
  agreeWindowEnd, afterCallEnd, tandemChatOpen, groupChatOpen,
  groupSide, validateGroup, GROUP_LANGUAGES,
}
