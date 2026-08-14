// Login-time syncTimezone() PATCHes a browser-detected zone and nothing
// else. A deliberate settings save always sends timezone_source alongside
// the zone — including "reset to auto-detect", which sends
// { timezone: <freshly detected>, timezone_source: 'auto' }.
//
// Only the first kind may be suppressed for a user who picked their zone
// manually. Keying off "is the incoming source not 'manual'" instead would
// also swallow the reset, leaving the user on their old manual zone with
// the flag flipped — the exact confusing half-state this flag exists to
// prevent.
function isImplicitAutoSync(updates) {
  return updates.timezone !== undefined && updates.timezone_source === undefined
}

module.exports = { isImplicitAutoSync }
