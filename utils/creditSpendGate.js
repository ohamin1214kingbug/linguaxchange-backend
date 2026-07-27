const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Pure. A spend is blocked when it would leave the user at 0 credits and
// they've never taught (i.e. never actually contributed supply back to the
// marketplace) — stops a purely-consuming user from draining their entire
// starting grant without ever teaching. Once a user has taught even once,
// this never applies to them again, at any balance.
function blocksSpend(balanceAfterSpend, hasTaughtBefore) {
  return balanceAfterSpend <= 0 && !hasTaughtBefore
}

// Earning a credit currently only happens by teaching (a student confirming
// attendance credits the teacher — see routes/enrollments.js POST /:id/confirm),
// so "has an earned credit_transactions row" is equivalent to "has taught
// before." Defaults to true (exempt/fail-open) on error so a lookup failure
// blocks nobody from joining a class.
async function hasEverTaught(userId) {
  try {
    const { count, error } = await supabase
      .from('credit_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'earned')

    if (error) return true
    return (count || 0) > 0
  } catch (e) {
    return true
  }
}

module.exports = { blocksSpend, hasEverTaught }
