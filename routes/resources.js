const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { validateResource } = require('../utils/resources')
const { decodePdf } = require('../utils/pdfUpload')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const RESOURCES_BUCKET = 'resources'
const PUBLIC_COLUMNS = 'id, language_code, level, audience, title, description, pdf_url, source_url, attribution, updated_at'

// ROUTE ORDER MATTERS. '/all' must be declared before '/:lang/:level' or
// Express would never reach it, and the router.use() guard below must come
// after every public route or it would lock them too.

// GET /api/resources — every published resource.
//
// Deliberately unauthenticated. Crawlers and logged-out visitors are the
// entire audience for this feature; requiring a token here would defeat the
// reason it exists. A row without a PDF is a draft and never leaves.
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('resources')
      .select(PUBLIC_COLUMNS)
      // Matches the detail route below, which serves learner guides only.
      // Without it, adding a teacher-audience row would put a URL in the
      // sitemap and a link in the grid that both 404, because every consumer
      // keys on (language, level) alone — and would emit the URL twice when a
      // learner row exists for the same pair.
      .eq('audience', 'learner')
      .not('pdf_url', 'is', null)
      .order('language_code')
      .order('level')
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not fetch resources' })
  }
})

// GET /api/resources/all — admin listing, drafts included. Separate from the
// public list because the admin tab needs to see rows whose PDF hasn't been
// uploaded yet, which is exactly what the public list filters out.
router.get('/all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('resources')
      .select(PUBLIC_COLUMNS)
      .order('language_code')
      .order('level')
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not fetch resources' })
  }
})

// GET /api/resources/:lang/:level — one resource, for the detail page.
router.get('/:lang/:level', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('resources')
      .select(PUBLIC_COLUMNS)
      .eq('language_code', String(req.params.lang).toUpperCase())
      .eq('level', String(req.params.level).toUpperCase())
      .eq('audience', 'learner')
      .not('pdf_url', 'is', null)
      .maybeSingle()
    if (error) return res.status(400).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'Resource not found' })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not fetch the resource' })
  }
})

// Everything below this line is admin-only.
router.use(requireAuth, requireAdmin)

// POST /api/resources — create or update the row for a (language, level,
// audience). The unique constraint makes this an upsert rather than a
// separate create and edit.
//
// pdf_url is intentionally not in the payload, so an upsert over an existing
// row leaves the uploaded PDF alone: PostgREST only updates the columns it
// was actually sent.
router.post('/', async (req, res) => {
  const v = validateResource(req.body)
  if (!v.ok) return res.status(400).json({ error: v.error })
  const { ok, ...fields } = v
  try {
    const { data, error } = await supabase
      .from('resources')
      .upsert(
        { ...fields, updated_at: new Date().toISOString() },
        { onConflict: 'language_code,level,audience' }
      )
      .select(PUBLIC_COLUMNS)
      .single()
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not save the resource' })
  }
})

// POST /api/resources/:id/pdf — replaces the guide PDF, or removes it when
// sent { pdf: null }.
//
// Base64 in a JSON body, mirroring the class materials upload, so the browser
// never needs the Supabase anon key. The bucket independently enforces
// PDF-only and 10MB, but decodePdf re-checks both so a bad request fails with
// a useful message rather than a storage error.
router.post('/:id/pdf', async (req, res) => {
  try {
    const { data: row, error: findError } = await supabase
      .from('resources')
      .select('id, language_code, level, audience')
      .eq('id', req.params.id)
      .single()
    if (findError || !row) return res.status(404).json({ error: 'Resource not found' })

    // Stable path, so re-uploading replaces rather than accumulating.
    const path = `${row.language_code}-${row.level}-${row.audience}.pdf`.toLowerCase()

    // Explicit null clears it. Undefined would be an accident; only an
    // outright null counts as "remove this".
    if (req.body.pdf === null) {
      await supabase.storage.from(RESOURCES_BUCKET).remove([path])
      const { data, error } = await supabase
        .from('resources')
        .update({ pdf_url: null, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .select(PUBLIC_COLUMNS)
        .single()
      if (error) return res.status(400).json({ error: error.message })
      return res.json(data)
    }

    const decoded = decodePdf(req.body.pdf)
    if (!decoded.ok) return res.status(400).json({ error: decoded.error })

    const { error: uploadError } = await supabase.storage
      .from(RESOURCES_BUCKET)
      .upload(path, decoded.buffer, { contentType: 'application/pdf', upsert: true })
    if (uploadError) return res.status(400).json({ error: uploadError.message })

    const { data: { publicUrl } } = supabase.storage
      .from(RESOURCES_BUCKET)
      .getPublicUrl(path)

    // Cache-bust: the path is stable across re-uploads, so without this a
    // replaced PDF would keep serving the old cached copy.
    const versioned = `${publicUrl}?v=${Date.now()}`

    const { data, error } = await supabase
      .from('resources')
      .update({ pdf_url: versioned, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .select(PUBLIC_COLUMNS)
      .single()
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not upload the PDF' })
  }
})

// DELETE /api/resources/:id — removes the row and its stored object.
router.delete('/:id', async (req, res) => {
  try {
    const { data: row } = await supabase
      .from('resources')
      .select('id, language_code, level, audience')
      .eq('id', req.params.id)
      .single()
    if (!row) return res.status(404).json({ error: 'Resource not found' })

    const path = `${row.language_code}-${row.level}-${row.audience}.pdf`.toLowerCase()
    await supabase.storage.from(RESOURCES_BUCKET).remove([path])

    const { error } = await supabase.from('resources').delete().eq('id', row.id)
    if (error) return res.status(400).json({ error: error.message })
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not delete the resource' })
  }
})

module.exports = router
