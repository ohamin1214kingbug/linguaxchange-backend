const { recordCreditTransaction } = require('../utils/creditLedger')

// A client whose insert resolves to whatever the test hands it, recording
// what was inserted where.
function clientReturning(result) {
  const calls = []
  return {
    calls,
    from: table => ({
      insert: rows => { calls.push({ table, rows }); return Promise.resolve(result) }
    })
  }
}

describe('recordCreditTransaction', () => {
  const row = { user_id: 12, amount: -1, type: 'spent', description: 'Joined a class' }
  let errorSpy

  beforeEach(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => errorSpy.mockRestore())

  test('writes the row to credit_transactions and stays quiet on success', async () => {
    const client = clientReturning({ error: null })
    await expect(recordCreditTransaction(client, row)).resolves.toBe(true)
    expect(client.calls).toEqual([{ table: 'credit_transactions', rows: [row] }])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  // The balance has already moved by the time this runs, so the caller must
  // carry on — but the missing row has to be findable in the logs, with
  // everything needed to write it by hand.
  test('logs the unsaved row instead of throwing when the insert fails', async () => {
    const client = clientReturning({ error: { message: 'connection reset' } })
    await expect(recordCreditTransaction(client, row)).resolves.toBe(false)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const logged = errorSpy.mock.calls[0].join(' ')
    expect(logged).toContain('[CREDIT_LEDGER]')
    expect(logged).toContain('connection reset')
    expect(logged).toContain('"user_id":12')
    expect(logged).toContain('"amount":-1')
  })
})
