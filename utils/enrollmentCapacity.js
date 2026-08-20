// The capacity check lives in a database trigger (see
// migrations/enforce_class_capacity.sql) so it can't be raced. That trigger
// signals a full session by raising this sentinel, which arrives here as an
// ordinary Postgres error. Translating it into a plain "class is full" is
// this module's only job.
const SESSION_FULL = 'CLASS_SESSION_FULL'

function isSessionFullError(error) {
  return typeof error?.message === 'string' && error.message.includes(SESSION_FULL)
}

module.exports = { SESSION_FULL, isSessionFullError }
