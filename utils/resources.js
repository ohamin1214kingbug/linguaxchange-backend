const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const LANGUAGE_CODES = ['KO', 'ES', 'DE', 'EN', 'PT', 'FR', 'IT']
const AUDIENCES = ['learner', 'teacher']
const MAX_TITLE = 200
const MAX_DESCRIPTION = 1000

// Validates an admin's resource submission. Returns the cleaned columns so
// the route can hand the result straight to the DB without re-reading
// req.body — the same shape validateReport uses in utils/reports.js.
//
// pdf_url is deliberately absent: it is only ever set by the upload endpoint
// from a URL the server itself built, never by an admin typing one in.
function validateResource(body = {}) {
  const language_code = String(body.language_code || '').toUpperCase()
  if (!LANGUAGE_CODES.includes(language_code)) return { ok: false, error: 'Unknown language' }

  const level = String(body.level || '').toUpperCase()
  if (!LEVELS.includes(level)) return { ok: false, error: 'Unknown level' }

  const audience = String(body.audience || 'learner').toLowerCase()
  if (!AUDIENCES.includes(audience)) return { ok: false, error: 'Unknown audience' }

  const title = String(body.title || '').trim()
  if (!title) return { ok: false, error: 'Title is required' }
  if (title.length > MAX_TITLE) return { ok: false, error: 'Title is too long' }

  const description = String(body.description || '').trim()
  if (description.length > MAX_DESCRIPTION) return { ok: false, error: 'Description is too long' }

  // Renders as a link on a public page, so the scheme is checked rather than
  // trusted: a javascript: URL stored here would be a stored XSS vector, and
  // a bare "uned.es" would resolve relative to our own domain and 404.
  const source_url = String(body.source_url || '').trim()
  if (source_url && !/^https?:\/\/\S+$/.test(source_url)) {
    return { ok: false, error: 'Source URL must start with http:// or https://' }
  }

  const attribution = String(body.attribution || '').trim()

  return {
    ok: true,
    language_code,
    level,
    audience,
    title,
    description: description || null,
    source_url: source_url || null,
    attribution: attribution || null,
  }
}

module.exports = { validateResource, LEVELS, LANGUAGE_CODES }
