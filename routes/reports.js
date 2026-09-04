const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { STATUSES, validateReport } = require('../utils/reports')
const { fail } = require('../utils/failure')
const { decodeImage, MAX_EVIDENCE } = require('../utils/imageUpload')
const { decodePdf } = require('../utils/pdfUpload')

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
    // Screenshots and PDFs both count as evidence: a chat log is a picture,
    // a transcript or an exported thread is a document. Each decoder checks
    // its own magic bytes, so neither trusts the declared content type.
    const decodedEvidence = []
    for (const dataUrl of evidence) {
      const asPdf = /^data:application\/pdf;base64,/.test(dataUrl || '')
      const decoded = asPdf ? decodePdf(dataUrl) : decodeImage(dataUrl)
      if (!decoded.ok) return res.status(400).json({ error: decoded.error })
      decodedEvidence.push(asPdf
        ? { ...decoded, ext: 'pdf', mime: 'application/pdf' }
        : decoded)
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

// GET /api/reports/reportable — the people this user could plausibly report:
// teachers whose classes they took, and students who took theirs.
//
// Its own endpoint rather than widening GET /api/classes?teacher_id=, which
// is public and unauthenticated — adding student names there would hand a
// teacher's whole roster to anyone who asked for it.
//
// Names and ids only, and never the caller themselves. Declared before the
// /:id routes below so "reportable" is not swallowed as a report id.
router.get('/reportable', requireAuth, async (req, res) => {
  try {
    const people = new Map()

    // Teachers of classes I enrolled in.
    const { data: mine } = await supabase
      .from('class_enrollments')
      .select('class_sessions(classes(teacher:users!teacher_id(id, first_name, last_name, deleted_at)))')
      .eq('user_id', req.userId)

    for (const row of mine || []) {
      const t = row.class_sessions?.classes?.teacher
      if (t && !t.deleted_at && t.id !== req.userId) {
        people.set(t.id, { id: t.id, first_name: t.first_name, last_name: t.last_name, relation: 'taught_me' })
      }
    }

    // Students who enrolled in classes I teach.
    const { data: taught } = await supabase
      .from('classes')
      .select('class_sessions(class_enrollments(users(id, first_name, last_name, deleted_at)))')
      .eq('teacher_id', req.userId)

    for (const cls of taught || []) {
      for (const session of cls.class_sessions || []) {
        for (const enrollment of session.class_enrollments || []) {
          const u = enrollment.users
          if (u && !u.deleted_at && u.id !== req.userId && !people.has(u.id)) {
            people.set(u.id, { id: u.id, first_name: u.first_name, last_name: u.last_name, relation: 'learned_from_me' })
          }
        }
      }
    }

    res.json([...people.values()])
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not load who you can report' })
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
