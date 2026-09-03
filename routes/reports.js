const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { STATUSES, validateReport } = require('../utils/reports')
const { fail } = require('../utils/failure')
const { decodeImage, MAX_EVIDENCE } = require('../utils/imageUpload')

const EVIDENCE_BUCKET = 'report-evidence'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// POST /api/reports — anyone signed in can flag a user or a class.
router.post('/', requireAuth, async (req, res) => {
  const check = validateReport(req.body)
  if (!check.ok) return res.status(400).json({ error: check.error })

  try {
    const { report_type, reported_type, reported_id, reason, category } = check

    if (report_type === 'user' && reported_id === req.userId) {
      return res.status(400).json({ error: 'You cannot report yourself' })
    }

    const evidence = Array.isArray(req.body.evidence) ? req.body.evidence : []
    if (evidence.length > MAX_EVIDENCE) {
      return res.status(400).json({ error: `At most ${MAX_EVIDENCE} images` })
    }

    // Decode before inserting the row. A rejected image after the insert
    // would leave a report standing whose evidence the reporter thinks they
    // attached.
    const decodedEvidence = []
    for (const dataUrl of evidence) {
      const decoded = decodeImage(dataUrl)
      if (!decoded.ok) return res.status(400).json({ error: decoded.error })
      decodedEvidence.push(decoded)
    }

    // One open report per reporter per target. The cheapest defence against
    // a retaliation flood — someone who has just been reported filing twenty
    // back. It does not stop someone with several accounts, and is not meant
    // to: phone verification is the control for that.
    const { data: existing } = await supabase
      .from('reports')
      .select('id')
      .eq('reporter_id', req.userId)
      .eq('report_type', report_type)
      .eq('reported_id', reported_id)
      .eq('status', 'pending')
      .maybeSingle()

    if (existing) {
      return res.status(409).json({ error: 'You already have a report about this open with us' })
    }

    const { data, error } = await supabase
      .from('reports')
      .insert([{ reporter_id: req.userId, report_type, reported_type, reported_id, reason, category, status: 'pending' }])
      .select()
      .single()

    if (error) return fail(res, 400, 'Could not submit report', error)

    const paths = []
    for (const [index, decoded] of decodedEvidence.entries()) {
      // Namespaced by report id so one report's evidence cannot collide with
      // another's, and the whole folder is removable in one call.
      const path = `${data.id}/${index}.${decoded.ext}`
      const { error: uploadError } = await supabase.storage
        .from(EVIDENCE_BUCKET)
        .upload(path, decoded.buffer, { contentType: decoded.mime, upsert: true })

      if (uploadError) return fail(res, 400, 'Could not upload the evidence', uploadError)
      paths.push(path)
    }

    if (paths.length) {
      await supabase.from('reports').update({ evidence_paths: paths }).eq('id', data.id)
      data.evidence_paths = paths
    }

    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not submit report' })
  }
})

// Severity first, then age. A harassment report filed this morning outranks
// eight no-shows from last week; ordering by date alone buried it.
const CATEGORY_RANK = {
  harassment: 0,
  inappropriate_content: 1,
  spam_or_scam: 2,
  no_show: 3,
  other: 4
}

// GET /api/reports — admin queue: open reports first, worst first.
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('reports')
      .select('*, reporter:users!reporter_id(id, first_name, last_name, email)')
      .order('created_at', { ascending: false })

    if (error) return fail(res, 400, 'Could not fetch reports', error)

    const reports = data || []

    // Not a PostgREST embed: reported_id holds a class id when report_type
    // is 'class', so no foreign key to users can exist on that column and an
    // embed would be wrong for half the rows. One follow-up query instead.
    const reportedIds = [...new Set(reports.filter(r => r.report_type === 'user').map(r => r.reported_id))]

    let byId = {}
    if (reportedIds.length) {
      const { data: users } = await supabase
        .from('users')
        .select('id, first_name, last_name, email, suspended_until, suspension_reason, deleted_at')
        .in('id', reportedIds)
      byId = Object.fromEntries((users || []).map(u => [u.id, u]))
    }

    const enriched = reports.map(r => ({
      ...r,
      reported_user: r.report_type === 'user' ? byId[r.reported_id] || null : null
    }))

    enriched.sort((a, b) => {
      const pending = (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)
      if (pending) return pending
      const severity = (CATEGORY_RANK[a.category] ?? 9) - (CATEGORY_RANK[b.category] ?? 9)
      if (severity) return severity
      return new Date(b.created_at) - new Date(a.created_at)
    })

    res.json(enriched)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch reports' })
  }
})

// PATCH /api/reports/:id — admin sets status/notes after reviewing.
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { status, notes } = req.body
  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }

  try {
    const updates = { updated_at: new Date().toISOString() }
    if (status !== undefined) updates.status = status
    if (notes !== undefined) updates.notes = notes

    const { data, error } = await supabase
      .from('reports')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return fail(res, 400, 'Could not update report', error)
    if (!data) return res.status(404).json({ error: 'Report not found' })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not update report' })
  }
})

// GET /api/reports/:id/evidence/:index — a short-lived signed URL.
//
// The bucket is private, so this is the only way to see the file. Signed
// rather than proxied because the image goes into an <img> tag, and a signed
// URL keeps the bytes out of this process entirely.
router.get('/:id/evidence/:index', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: report, error } = await supabase
      .from('reports')
      .select('evidence_paths')
      .eq('id', req.params.id)
      .single()

    if (error || !report) return res.status(404).json({ error: 'Report not found' })

    const path = (report.evidence_paths || [])[parseInt(req.params.index)]
    if (!path) return res.status(404).json({ error: 'No evidence at that position' })

    const { data: signed, error: signError } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(path, 60 * 60)

    if (signError) return fail(res, 400, 'Could not open the evidence', signError)
    res.json({ url: signed.signedUrl })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not open the evidence' })
  }
})

module.exports = router
