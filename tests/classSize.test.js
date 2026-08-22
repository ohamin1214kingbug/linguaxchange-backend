const { MIN_CLASS_SIZE, MAX_CLASS_SIZE, isValidClassSize } = require('../utils/classSize')

// The bug this guards against: a student could post a request for 2
// students because class_requests allowed 1-20, while the classes table
// only allowed 3-10 — so answering that request blew up on a CHECK
// constraint and looked like the system rejecting the teacher. Every
// surface now shares these bounds, so they have to stay in step with the
// database's own constraints (migrations/align_class_size_range.sql).
describe('class size bounds', () => {
  test('the range is 1 to 6', () => {
    expect(MIN_CLASS_SIZE).toBe(1)
    expect(MAX_CLASS_SIZE).toBe(6)
  })

  test('one-to-one and pair tutoring are valid sizes', () => {
    expect(isValidClassSize(1)).toBe(true)
    expect(isValidClassSize(2)).toBe(true)
  })

  test('sizes the old classes constraint allowed but are now too big', () => {
    expect(isValidClassSize(7)).toBe(false)
    expect(isValidClassSize(10)).toBe(false)
  })

  test('sizes the old request form allowed are rejected', () => {
    expect(isValidClassSize(15)).toBe(false)
    expect(isValidClassSize(20)).toBe(false)
  })

  test('zero and negatives are not class sizes', () => {
    expect(isValidClassSize(0)).toBe(false)
    expect(isValidClassSize(-1)).toBe(false)
  })

  test('a numeric string from a form body is accepted', () => {
    expect(isValidClassSize('3')).toBe(true)
  })

  test('fractions and non-numbers are rejected', () => {
    expect(isValidClassSize(2.5)).toBe(false)
    expect(isValidClassSize('lots')).toBe(false)
    expect(isValidClassSize(null)).toBe(false)
    expect(isValidClassSize(undefined)).toBe(false)
    expect(isValidClassSize('')).toBe(false)
  })
})
