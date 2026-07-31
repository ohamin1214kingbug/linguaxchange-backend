// JWTs are stateless by design, so "logging out" or changing a password
// can't delete a token that's already been issued — the only lever is
// telling requireAuth to stop honoring tokens issued before some instant.
// tokenIat is the JWT's `iat` claim (seconds since epoch); tokenValidAfter
// is the user's stored cutoff (Date, ISO string, or null/undefined if the
// account has never been logged out / had its password reset).
function isTokenStillValid(tokenIat, tokenValidAfter) {
  if (!tokenValidAfter) return true
  return tokenIat * 1000 >= new Date(tokenValidAfter).getTime()
}

module.exports = { isTokenStillValid }
