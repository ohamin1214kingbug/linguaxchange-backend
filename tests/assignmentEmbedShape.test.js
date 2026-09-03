// PostgREST embeds a to-one relationship as an object, not an array.
// assignment_feedback.request_id is UNIQUE, so it infers one-to-one and
// returns `{...}` where every consumer expected `[{...}]`.
//
// In production that meant: the board showed answered requests as unanswered,
// the detail page rendered the annotation editor instead of the feedback, and
// the withdraw guard never fired. All three from `.length` and `[0]` on an
// object. This locks the normalisation in.

const withFeedbackArray = row => {
  if (!row) return row
  const fb = row.assignment_feedback
  return { ...row, assignment_feedback: Array.isArray(fb) ? fb : fb ? [fb] : [] }
}

describe('withFeedbackArray', () => {
  test('wraps the single object PostgREST actually returns', () => {
    const r = withFeedbackArray({ id: 4, assignment_feedback: { id: 3, overall: 'good' } })
    expect(Array.isArray(r.assignment_feedback)).toBe(true)
    expect(r.assignment_feedback).toHaveLength(1)
    expect(r.assignment_feedback[0].id).toBe(3)
  })

  test('leaves an array alone, so a future PostgREST change does not double-wrap', () => {
    const r = withFeedbackArray({ id: 4, assignment_feedback: [{ id: 3 }] })
    expect(r.assignment_feedback).toHaveLength(1)
    expect(r.assignment_feedback[0].id).toBe(3)
  })

  test('an unanswered request becomes an empty array, not undefined', () => {
    // This is the case the board's `.length > 0` check depends on.
    expect(withFeedbackArray({ id: 4, assignment_feedback: null }).assignment_feedback).toEqual([])
    expect(withFeedbackArray({ id: 4 }).assignment_feedback).toEqual([])
  })

  test('the answered check works after normalising, and would not before', () => {
    const raw = { id: 4, assignment_feedback: { id: 3 } }
    // The bug, preserved so the regression is visible:
    expect((raw.assignment_feedback || []).length > 0).toBe(false)
    // The fix:
    expect(withFeedbackArray(raw).assignment_feedback.length > 0).toBe(true)
  })

  test('passes a null row through rather than throwing', () => {
    expect(withFeedbackArray(null)).toBe(null)
  })
})
