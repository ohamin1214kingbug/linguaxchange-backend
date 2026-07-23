const { buildRoomName } = require('../utils/roomName')

describe('buildRoomName', () => {
  test('is deterministic for the same session id and secret', () => {
    const a = buildRoomName(42, 'secret')
    const b = buildRoomName(42, 'secret')
    expect(a).toBe(b)
  })

  test('embeds the session id in the room name', () => {
    expect(buildRoomName(42, 'secret')).toMatch(/^linguaxchange-42-/)
  })

  test('is not guessable from the session id alone (different secrets diverge)', () => {
    const a = buildRoomName(42, 'secret-one')
    const b = buildRoomName(42, 'secret-two')
    expect(a).not.toBe(b)
  })

  test('different session ids produce different room names', () => {
    const a = buildRoomName(1, 'secret')
    const b = buildRoomName(2, 'secret')
    expect(a).not.toBe(b)
  })
})
