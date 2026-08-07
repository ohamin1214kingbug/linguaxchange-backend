// Mirrors the DB check constraints on `reports` exactly (reports_report_type_check,
// reports_reported_type_check, reports_status_check) — 'content' has no matching
// reported_type option in the schema, so there's nothing to attach a content report
// to yet; only user/class reports are wired up until that changes.
const REPORT_TYPES = ['user', 'class']
const STATUSES = ['pending', 'reviewed', 'resolved', 'rejected']
const MAX_REASON = 500

function validateReport(body = {}) {
  if (!REPORT_TYPES.includes(body.report_type)) {
    return { ok: false, error: 'report_type must be user or class' }
  }

  const reportedId = parseInt(body.reported_id)
  if (!reportedId) return { ok: false, error: 'reported_id is required' }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) return { ok: false, error: 'A reason is required' }
  if (reason.length > MAX_REASON) {
    return { ok: false, error: `Reason must be ${MAX_REASON} characters or fewer` }
  }

  return {
    ok: true,
    report_type: body.report_type,
    reported_type: body.report_type, // same enum values, one flag drives both
    reported_id: reportedId,
    reason
  }
}

module.exports = { REPORT_TYPES, STATUSES, MAX_REASON, validateReport }
