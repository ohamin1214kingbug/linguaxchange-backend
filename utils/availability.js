// When2meet-style free hours for a class request (owner, 2026-11-27): the
// student who asks and everyone who +1s mark the hours they are free in the
// next 7 days, and teachers of that language see how many are free each
// hour. Pure, so the rules are tested without a database.
//
// A slot is the start of one hour, stored in UTC. Shown in each viewer's own
// time zone, so a slot may fall on :00 or :30 UTC (India is UTC+5:30, for
// one); :15/:45 offsets (Nepal) round to the nearest half hour on screen.
const HOUR = 60 * 60 * 1000
const DAYS_AHEAD = 7
const MAX_SLOTS = DAYS_AHEAD * 24

// The slots to keep, or null when the input isn't a list. Drops anything
// malformed, off the half hour, in the past or more than 7 days ahead, and
// duplicates. Sorted.
function cleanSlots(slots, now = new Date()) {
  if (!Array.isArray(slots)) return null
  const end = now.getTime() + DAYS_AHEAD * 24 * HOUR
  const kept = new Set()
  for (const s of slots) {
    const d = new Date(s)
    const t = d.getTime()
    if (typeof s !== 'string' || isNaN(t)) continue
    if (d.getUTCSeconds() || d.getUTCMilliseconds() || d.getUTCMinutes() % 30) continue
    if (t <= now.getTime() || t > end) continue
    kept.add(d.toISOString())
  }
  return [...kept].sort().slice(0, MAX_SLOTS)
}

// [{ user_id, first_name, slots }] -> [{ slot, count, names }], busiest
// first, then earliest. Only future slots count.
function heatmap(rows, now = new Date()) {
  const by = new Map()
  for (const r of rows || []) {
    for (const slot of r.slots || []) {
      if (new Date(slot).getTime() <= now.getTime()) continue
      const cell = by.get(slot) || { slot, count: 0, names: [] }
      cell.count++
      if (r.first_name) cell.names.push(r.first_name)
      by.set(slot, cell)
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.slot.localeCompare(b.slot))
}

module.exports = { cleanSlots, heatmap, DAYS_AHEAD, MAX_SLOTS }
