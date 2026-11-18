// Tandem matching (routes/tandems.js). Pure, so the rules are tested
// without a database.
//
// A perfect match teaches a language I learn AND learns the one I teach.
// A one-way match only teaches a language I learn. Perfect matches come
// first, then one-way; within each, members who share more free times
// (survey answers) come first.
// ponytail: compares every opted-in member in memory; fine for hundreds,
// move the filter into SQL when the opted-in list gets into the thousands.

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
    }))
    .sort((a, b) => (b.perfect - a.perfect) || (b.sharedTimes - a.sharedTimes) || (b.id - a.id))
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

module.exports = { tandemMatches, tandemRole, cleanHello, HELLO_MAX }
