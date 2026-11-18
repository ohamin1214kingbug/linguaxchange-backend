// The member survey: five questions, one answer set per member, 1 bonus
// banana when finished (migrations/add_member_survey.sql). Pure validation
// here; routes/survey.js stores answers and grants the banana.
const HEARD = ['instagram', 'tiktok', 'youtube', 'poster', 'friend', 'faculty', 'google', 'other']
const WHO = ['ucm', 'erasmus', 'other_uni', 'not_student']
const GOALS = ['speaking', 'exam', 'travel', 'career', 'people']
const TIMES = ['weekday_morning', 'weekday_afternoon', 'weekday_evening', 'weekend']
const MAX_GOALS = 2

const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

// Keeps only valid answers from a partial or full body. Unknown values are
// dropped rather than refused, so one bad field never loses the others.
function cleanAnswers(body = {}) {
  const out = {}
  if (body.heard_from !== undefined) out.heard_from = HEARD.includes(body.heard_from) ? body.heard_from : null
  if (body.heard_detail !== undefined) out.heard_detail = text(body.heard_detail, 80)
  if (body.who !== undefined) out.who = WHO.includes(body.who) ? body.who : null
  if (body.who_detail !== undefined) out.who_detail = text(body.who_detail, 80)
  if (body.goals !== undefined) out.goals = [...new Set((Array.isArray(body.goals) ? body.goals : []).filter(g => GOALS.includes(g)))].slice(0, MAX_GOALS)
  if (body.times !== undefined) out.times = [...new Set((Array.isArray(body.times) ? body.times : []).filter(t => TIMES.includes(t)))]
  if (body.ideas !== undefined) out.ideas = text(body.ideas, 500)
  return out
}

// Questions 1–4 are required to finish; 5 (ideas) is optional.
function isComplete(row = {}) {
  return Boolean(row.heard_from && row.who && (row.goals || []).length && (row.times || []).length)
}

// Counts per answer for the admin Growth tab.
function summarize(rows = []) {
  const done = rows.filter(r => r.completed_at)
  const count = (key, list) => Object.fromEntries(list.map(v => [v, done.filter(r => (Array.isArray(r[key]) ? r[key].includes(v) : r[key] === v)).length]))
  const details = (key, value, detailKey) => {
    const tally = {}
    for (const r of done) if (r[key] === value && r[detailKey]) tally[r[detailKey]] = (tally[r[detailKey]] || 0) + 1
    return tally
  }
  return {
    answered: done.length,
    heard: count('heard_from', HEARD),
    posterFaculties: details('heard_from', 'poster', 'heard_detail'),
    heardOther: done.filter(r => r.heard_from === 'other' && r.heard_detail).map(r => r.heard_detail).slice(0, 10),
    who: count('who', WHO),
    ucmFaculties: details('who', 'ucm', 'who_detail'),
    goals: count('goals', GOALS),
    times: count('times', TIMES),
    ideas: done.filter(r => r.ideas).sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at)).map(r => r.ideas).slice(0, 10),
  }
}

module.exports = { HEARD, WHO, GOALS, TIMES, MAX_GOALS, cleanAnswers, isComplete, summarize }
