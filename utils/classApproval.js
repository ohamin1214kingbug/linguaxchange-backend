const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Pure. Teachers whose account is already admin-approved get their classes
// published immediately — the account-level review already vetted them.
// Everyone else still goes through the pending-review queue.
function initialClassStatus(teacherIsApproved) {
  return teacherIsApproved ? 'approved' : 'pending'
}

// Defaults to false (fail-closed) on error — a lookup failure should never
// accidentally skip moderation for an unvetted teacher.
async function getTeacherIsApproved(userId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('is_approved')
      .eq('id', userId)
      .single()

    if (error || !data) return false
    return !!data.is_approved
  } catch (e) {
    return false
  }
}

module.exports = { initialClassStatus, getTeacherIsApproved }
