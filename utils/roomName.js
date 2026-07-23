const crypto = require('crypto')

// Deterministic but unguessable room name, so outsiders on the public
// Jitsi server can't stumble into a class by scanning session ids.
function buildRoomName(classSessionId, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(String(classSessionId))
    .digest('hex')
    .slice(0, 16)

  return `linguaxchange-${classSessionId}-${hash}`
}

module.exports = { buildRoomName }
