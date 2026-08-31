// Counts what the site can prove about a member: classes attended and classes
// taught. Nothing self-declared appears in a record, because the record's only
// value is that a third party can trust it.

const minutes = rows =>
  rows.reduce((total, row) => total + (Number(row?.duration_minutes) || 0), 0)

const distinct = (rows, key) =>
  [...new Set(rows.map(row => row?.[key]).filter(Boolean))]

function summarise({ attended = [], taught = [] } = {}) {
  const all = [...attended, ...taught]

  // A row with no date still counts toward totals — it happened — but cannot
  // bound the range, so it is skipped here rather than turning the range into
  // an Invalid Date.
  const times = all
    .map(row => row?.date)
    .filter(Boolean)
    .map(date => new Date(date).getTime())
    .filter(time => !Number.isNaN(time))

  return {
    attendedCount: attended.length,
    taughtCount: taught.length,
    attendedMinutes: minutes(attended),
    taughtMinutes: minutes(taught),
    languages: distinct(all, 'language_code'),
    levels: distinct(all, 'level'),
    firstActivity: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastActivity: times.length ? new Date(Math.max(...times)).toISOString() : null,
  }
}

module.exports = { summarise }
