const { isSessionFullError } = require('../utils/enrollmentCapacity')

// The risk this guards against isn't a crash — it's misreporting. A full
// class must not surface as a generic database error, and an unrelated
// failure must not be excused as "the class is full" while the real cause
// goes unlogged.
describe('isSessionFullError', () => {
  test('recognises the trigger sentinel', () => {
    // Postgres prefixes RAISE output, so the match has to survive wrapping.
    expect(isSessionFullError({ message: 'CLASS_SESSION_FULL' })).toBe(true)
    expect(isSessionFullError({ code: 'P0001', message: 'CLASS_SESSION_FULL' })).toBe(true)
  })

  test('any other database failure is not treated as a full class', () => {
    expect(isSessionFullError({ message: 'duplicate key value violates unique constraint' })).toBe(false)
    expect(isSessionFullError({ message: 'insert or update violates foreign key constraint' })).toBe(false)
  })

  test('a missing or malformed error is not a full class', () => {
    expect(isSessionFullError(null)).toBe(false)
    expect(isSessionFullError(undefined)).toBe(false)
    expect(isSessionFullError({})).toBe(false)
    expect(isSessionFullError({ message: null })).toBe(false)
  })
})
