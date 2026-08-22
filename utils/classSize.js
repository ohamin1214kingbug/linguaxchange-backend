// One definition of how big a class may be, because having several is what
// broke: class_requests allowed 1-20, the classes table allowed 3-10, and
// the create-class route checked only "> 0". A student could post a request
// for 2 students, and it saved — then answering it failed on the classes
// CHECK constraint, which looked like the system rejecting the teacher.
//
// 1 is allowed: one-to-one tutoring is a real offering, and the credit
// maths is unchanged (each student spends one, the teacher earns one per
// attendee). 6 is the ceiling because these are live video conversation
// classes — an hour split six ways is already ten minutes of speaking time
// each.
//
// Kept in step with the database's own CHECK constraints in
// migrations/align_class_size_range.sql. The database is what actually
// enforces this; these exist so a bad value fails with a sentence a person
// can act on instead of a raw constraint-violation string.
const MIN_CLASS_SIZE = 1
const MAX_CLASS_SIZE = 6

function isValidClassSize(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= MIN_CLASS_SIZE && n <= MAX_CLASS_SIZE
}

const CLASS_SIZE_ERROR = `Class size must be between ${MIN_CLASS_SIZE} and ${MAX_CLASS_SIZE}`

module.exports = { MIN_CLASS_SIZE, MAX_CLASS_SIZE, isValidClassSize, CLASS_SIZE_ERROR }
