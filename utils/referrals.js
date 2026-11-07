const { createClient } = require('@supabase/supabase-js')
const { recordCreditTransaction } = require('./creditLedger')
const { pushNotifications } = require('./push')

let client
function db() {
  if (!client) client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  return client
}

// A member's invite code is their public member code (U000012), the one
// already shown on every profile, so there is nothing new to store or leak.
// ponytail: a cap, not fraud detection. Phone verification already limits
// accounts per number; revisit if one referrer approaches the cap.
const MAX_REWARDED_INVITES = 10

// Pure. "U000012", "u12" and "12" all mean member 12; anything else is no code.
function parseInviteCode(code) {
  const match = /^u?0*(\d{1,9})$/i.exec(String(code || '').trim())
  const id = match ? Number(match[1]) : 0
  return id > 0 ? id : null
}

// Who invited a new member, checked against the database: an unknown or
// deleted member, or the new member themselves, means no referrer.
async function resolveReferrer(code, newUserId = null) {
  const id = parseInviteCode(code)
  if (!id || id === newUserId) return null
  const { data } = await db().from('users').select('id, deleted_at').eq('id', id).maybeSingle()
  return data && !data.deleted_at ? data.id : null
}

async function grantBonus(userId, description) {
  const { data: balance, error } = await db().rpc('add_credit', { p_user_id: userId, p_amount: 1 })
  if (error || balance === null) {
    console.error('[REFERRAL] bonus not applied for user', userId, error?.message || 'no credits row')
    return false
  }
  await recordCreditTransaction(db(), { user_id: userId, amount: 1, type: 'bonus', description })
  return true
}

// Called when a member has attended a class: on their own attendance
// confirm, or when the 72-hour payout treats them as attended. The first
// class of an invited member pays a banana to them and to whoever invited
// them. The claim on referral_rewarded_at is what makes it once-only, from
// either path. Never throws.
async function rewardReferral(studentId) {
  try {
    const { data: claimed, error } = await db()
      .from('users')
      .update({ referral_rewarded_at: new Date().toISOString() })
      .eq('id', studentId)
      .not('referred_by', 'is', null)
      .is('referral_rewarded_at', null)
      .select('id, first_name, referred_by')
    if (error) {
      console.error('[REFERRAL] claim failed for user', studentId, error.message)
      return { rewarded: false }
    }
    const friend = claimed?.[0]
    if (!friend) return { rewarded: false }

    await grantBonus(friend.id, 'Welcome banana: your first class after being invited')

    const { count } = await db()
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('referred_by', friend.referred_by)
      .not('referral_rewarded_at', 'is', null)
    const referrerPaid = (count || 0) <= MAX_REWARDED_INVITES
      && await grantBonus(friend.referred_by, `Invite banana: ${friend.first_name || 'a friend'} took their first class`)

    const rows = [{ user_id: friend.id, type: 'credit_added', message: 'You got a welcome banana for taking your first class.' }]
    if (referrerPaid) rows.push({ user_id: friend.referred_by, type: 'credit_added', message: `${friend.first_name || 'A friend you invited'} took their first class. You got a banana.` })
    const { error: notifyError } = await db().from('notifications').insert(rows)
    if (notifyError) console.error('[REFERRAL] notification not saved:', notifyError.message)
    else pushNotifications(rows)

    return { rewarded: true, referrerPaid }
  } catch (e) {
    console.error('[REFERRAL] failed for user', studentId, e.message)
    return { rewarded: false }
  }
}

// What the dashboard's invite card shows: how many joined with the member's
// link, and how many of those have taken a class (and so paid out).
async function referralStats(userId) {
  const { data, error } = await db()
    .from('users')
    .select('referral_rewarded_at')
    .eq('referred_by', userId)
    .is('deleted_at', null)
  if (error) return null
  return {
    joined: data.length,
    rewarded: data.filter(u => u.referral_rewarded_at).length,
    max_rewarded: MAX_REWARDED_INVITES,
  }
}

module.exports = { MAX_REWARDED_INVITES, parseInviteCode, resolveReferrer, rewardReferral, referralStats }
