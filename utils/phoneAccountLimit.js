const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Caps how many accounts can share one verified phone number. Closes the
// loophole of creating disposable accounts (Google or email/password) just
// to re-farm the signup credit grant, since a real attacker only ever has
// one or two real phones to verify with.
const MAX_ACCOUNTS_PER_PHONE = 2

async function phoneAccountLimitReached(phone_number) {
  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('phone_number', phone_number)
    .eq('phone_verified', true)

  if (error) throw error
  return (count || 0) >= MAX_ACCOUNTS_PER_PHONE
}

module.exports = { phoneAccountLimitReached, MAX_ACCOUNTS_PER_PHONE }
