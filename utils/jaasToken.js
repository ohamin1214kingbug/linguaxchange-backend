const jwt = require('jsonwebtoken')

// JaaS signs every join with an RS256 token. This is what fixes the "no
// moderators have yet arrived" dead-end we hit on the free meet.jit.si
// server: the teacher's token carries moderator=true, so the room actually
// starts, and nobody has to log in to a Jitsi/Google account.
//
// Railway (like most hosts) mangles PEM newlines into literal \n, so undo
// that here rather than at every call site.
function normalizeKey(privateKey) {
  return String(privateKey).replace(/\\n/g, '\n')
}

function buildJaasToken({ appId, kid, privateKey, room, userId, displayName, isModerator, now = Date.now() }) {
  const nowSec = Math.floor(now / 1000)

  return jwt.sign(
    {
      aud: 'jitsi',
      iss: 'chat',
      sub: appId,
      room,
      nbf: nowSec - 10, // tolerate small clock skew between us and 8x8
      exp: nowSec + 2 * 60 * 60, // classes run ~1h; 2h covers a late joiner
      context: {
        user: {
          id: String(userId),
          name: displayName,
          moderator: isModerator ? 'true' : 'false'
        },
        // Every billable add-on explicitly off. We're on the free tier and
        // don't record classes (see the privacy policy), and recording +
        // streaming bill at $0.01/min if something ever flips them on.
        features: {
          livestreaming: false,
          recording: false,
          transcription: false,
          'outbound-call': false
        }
      }
    },
    normalizeKey(privateKey),
    { algorithm: 'RS256', header: { kid, typ: 'JWT' } }
  )
}

module.exports = { buildJaasToken, normalizeKey }
