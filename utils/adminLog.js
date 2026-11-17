// The admin activity log (migrations/add_admin_actions.sql). Every admin
// action that changes something or opens a private file calls this after
// it succeeds. Never throws: the action has already happened, and a failed
// log write shouldn't turn it into an error. Failures go to the server log.
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

async function logAdminAction(adminId, action, { targetType = null, targetId = null, detail = {} } = {}) {
  try {
    const { error } = await supabase.from('admin_actions')
      .insert([{ admin_id: adminId, action, target_type: targetType, target_id: targetId, detail }])
    if (error) console.error('[ADMIN_LOG]', action, error.message)
  } catch (e) {
    console.error('[ADMIN_LOG]', action, e.message)
  }
}

module.exports = { logAdminAction }
