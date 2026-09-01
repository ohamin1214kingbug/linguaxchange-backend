const { fail } = require('../utils/failure')

function fakeRes() {
  const out = {}
  return {
    out,
    status(code) { out.status = code; return this },
    json(body) { out.body = body; return this }
  }
}

describe('fail', () => {
  let logged
  beforeEach(() => {
    logged = []
    jest.spyOn(console, 'error').mockImplementation((...a) => logged.push(a))
  })
  afterEach(() => console.error.mockRestore())

  // The whole point: whatever Postgres said stays server-side. A raw message
  // like "duplicate key value violates unique constraint users_email_key"
  // names the table, the column and the naming convention.
  it('sends the given message, never the underlying cause', () => {
    const res = fakeRes()
    const cause = new Error('duplicate key value violates unique constraint users_email_key')
    fail(res, 400, 'Could not create your account', cause)

    expect(res.out.status).toBe(400)
    expect(res.out.body).toEqual({ error: 'Could not create your account' })
    expect(JSON.stringify(res.out.body)).not.toContain('users_email_key')
  })

  it('logs the cause so nothing is lost for debugging', () => {
    const res = fakeRes()
    const cause = { code: '23503', message: 'violates foreign key constraint' }
    fail(res, 400, 'Could not save teacher', cause)

    expect(logged).toHaveLength(1)
    expect(logged[0]).toEqual(['Could not save teacher', cause])
  })

  it('logs nothing when there is no cause', () => {
    const res = fakeRes()
    fail(res, 404, 'Resource not found')

    expect(logged).toHaveLength(0)
    expect(res.out.body).toEqual({ error: 'Resource not found' })
  })
})
