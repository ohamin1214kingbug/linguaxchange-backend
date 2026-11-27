const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { recordCreditTransaction } = require('../utils/creditLedger')
const { requireAuth, requireAdmin, isAdmin } = require('../middleware/auth')
const { resetLowCreditNotificationIfToppedUp } = require('../utils/lowCreditNudge')
const { fail } = require('../utils/failure')
const { openReply } = require('../utils/replyToken')
const { countryName } = require('../utils/adminNotify')
const { phoneNowWorksEmail } = require('../scripts/phoneNowWorks')
const { FRONTEND_URL } = require('../utils/frontendUrl')
const { sendEmail } = require('../utils/mailer')
const { renderEmail, CONTACT } = require('../utils/emailTemplate')
const { deleteAccount } = require('../utils/deleteAccount')
const { buildGrowth } = require('../utils/growth')
const { logAdminAction } = require('../utils/adminLog')
const { loadDigest } = require('../utils/adminDigest')
const { summarize } = require('../utils/survey')
const { cancelTeacherClasses } = require('../utils/classCancellation')
const { pushNotifications } = require('../utils/push')
const { certificatePaths, CERTIFICATE_BUCKET } = require('../utils/certificateUpload')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

router.use(requireAuth, requireAdmin)

// Explicit allowlist rather than select('*') — excludes password_hash and
// reset_token/reset_token_expires, which have no reason to leave the DB.
const ADMIN_USER_COLUMNS = 'id, email, first_name, last_name, nationality, bio, photo_url, teach_language, teach_level, learn_languages, has_certificate, certificate_explanation, certificate_name, certificate_uploaded_at, learn_details, teaching_paused_until, booking_limited_until, is_approved, approval_reason, current_streak, longest_streak, timezone, phone_number, phone_verified, google_id, created_at, suspended_until, suspension_reason, deleted_at'

// GET /api/admin/actions?group=bananas|safety|private — the Activity tab,
// newest first, with the admin's and the member's first names.
const ACTION_GROUPS = {
  bananas: ['give_bananas'],
  safety: ['suspend', 'unsuspend', 'delete_member', 'lift_no_show', 'reject_member', 'reject_class'],
  private: ['open_certificate', 'open_evidence', 'remove_certificate'],
}
// The page behind the button in the blocked-country email
// (utils/adminNotify.js): shows who it is for, then sends them the branded
// "your phone code works now" email from notifications@ (owner, 2026-11-27).
// ponytail: "already sent" lives in memory, so after a deploy the page could
// send a second copy; fine for a handful of these a week.
const blockedReplied = new Set()
const byEmail = email => supabase.from('users').select('first_name, phone_verified').ilike('email', email.replace(/[\\%_]/g, '\\$&')).maybeSingle()
function blockedReply(t) {
  const data = openReply(t)
  if (!data?.email) return null
  const country = countryName(data.country)
  const url = `${FRONTEND_URL}${data.method === 'google' ? '/auth/login' : '/auth/register'}`
  return { ...data, countryLabel: country, url }
}

router.get('/blocked-reply', async (req, res) => {
  const r = blockedReply(req.query.t)
  if (!r) return res.status(400).json({ error: 'This link is out of date or broken. Links work for 7 days.' })
  const { data: u } = await byEmail(r.email)
  res.json({ email: r.email, country: r.countryLabel, method: r.method === 'google' ? 'Google' : 'email',
    first_name: u?.first_name || '', phone_verified: Boolean(u?.phone_verified), sent: blockedReplied.has(req.query.t) })
})

router.post('/blocked-reply', async (req, res) => {
  const t = req.body?.t
  const r = blockedReply(t)
  if (!r) return res.status(400).json({ error: 'This link is out of date or broken. Links work for 7 days.' })
  if (blockedReplied.has(t)) return res.status(409).json({ error: 'Already sent.' })
  const { data: u } = await byEmail(r.email)
  const mail = phoneNowWorksEmail(u?.first_name || 'there', r.countryLabel, {
    url: r.url, footnote: 'Still no code? Write to gongbuleng.team@gmail.com and we’ll sort it out.',
  })
  blockedReplied.add(t) // before the await, so a double click can't send twice
  const sent = await sendEmail({ to: r.email, ...mail })
  if (!sent.ok) {
    blockedReplied.delete(t)
    return res.status(502).json({ error: 'The email could not be sent. Try again in a minute.' })
  }
  logAdminAction(req.userId, 'blocked_reply', { detail: { country: r.country } })
  res.json({ ok: true })
})

router.get('/actions', async (req, res) => {
  try {
    let query = supabase.from('admin_actions')
      .select('id, action, target_type, target_id, detail, created_at, admin:users!admin_id(first_name)')
      .order('created_at', { ascending: false }).limit(200)
    if (ACTION_GROUPS[req.query.group]) query = query.in('action', ACTION_GROUPS[req.query.group])
    const { data, error } = await query
    if (error) return fail(res, 400, 'Could not load the activity log', error)
    const userIds = [...new Set(data.filter(a => a.target_type === 'user').map(a => a.target_id))]
    const { data: people } = userIds.length
      ? await supabase.from('users').select('id, first_name').in('id', userIds)
      : { data: [] }
    const names = Object.fromEntries((people || []).map(p => [p.id, p.first_name]))
    res.json(data.map(a => ({ ...a, admin_name: a.admin?.first_name || '', target_name: a.target_type === 'user' ? names[a.target_id] || '' : '' })))
  } catch (e) {
    fail(res, 500, 'Could not load the activity log', e)
  }
})

// GET /api/admin/attention — the same list the daily email sends.
router.get('/attention', async (req, res) => {
  try {
    res.json(await loadDigest())
  } catch (e) {
    fail(res, 500, 'Could not load what needs attention', e)
  }
})

// GET /api/admin/survey — survey results for the Growth tab (counts, plus
// the latest free-text answers).
router.get('/survey', async (req, res) => {
  try {
    const { data, error } = await supabase.from('survey_responses')
      .select('heard_from, heard_detail, who, who_detail, goals, times, ideas, completed_at')
    if (error) return fail(res, 400, 'Could not load survey results', error)
    res.json(summarize(data))
  } catch (e) {
    fail(res, 500, 'Could not load survey results', e)
  }
})

// GET /api/admin/growth — the Growth tab: how far members get, per week of
// sign-up, and classes vs learners per language (utils/growth.js).
// ponytail: loads every member and booking; fine for hundreds of members,
// move the counting into SQL past a few thousand.
router.get('/growth', async (req, res) => {
  try {
    const now = new Date()
    const [users, enrollments, classes, upcoming] = await Promise.all([
      supabase.from('users').select('id, created_at, phone_verified, photo_url, teach_language, learn_languages').is('deleted_at', null),
      supabase.from('class_enrollments').select('user_id, status, attended'),
      supabase.from('classes').select('teacher_id, status'),
      supabase.from('class_sessions').select('id, classes!inner(language_code, status)')
        .eq('classes.status', 'approved').neq('status', 'cancelled').gt('session_date', now.toISOString()),
    ])
    const failed = [users, enrollments, classes, upcoming].find(r => r.error)
    if (failed) return fail(res, 400, 'Could not load growth numbers', failed.error)
    res.json(buildGrowth({
      users: users.data, enrollments: enrollments.data, classes: classes.data,
      upcoming: upcoming.data.map(s => ({ language_code: s.classes.language_code })), now,
    }))
  } catch (e) {
    fail(res, 500, 'Could not load growth numbers', e)
  }
})

router.get('/users', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select(ADMIN_USER_COLUMNS)
      .order('created_at', { ascending: false })
    if (error) return fail(res, 400, 'Could not fetch users', error)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch users' })
  }
})

// Teacher and enrolled students come back with the class. The admin screen
// exists to decide whether a class should run, and "who is teaching it and
// who signed up" is the part of that decision the row alone cannot answer.
// Enrollments hang off class_sessions, not off the class, so the nesting
// mirrors routes/classes.js rather than inventing a second shape.
router.get('/classes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('classes')
      .select('*, teacher:users!teacher_id(id, first_name, last_name), class_sessions(id, session_date, status, class_enrollments(status, student:users!user_id(id, first_name, last_name)))')
      .order('created_at', { ascending: false })
    if (error) return fail(res, 400, 'Could not fetch classes', error)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch classes' })
  }
})

// GET /api/admin/users/:id/certificate — the bucket is private, so a
// 10-minute signed link is the only way to open the file.
router.get('/users/:id/certificate', async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users').select('certificate_path').eq('id', req.params.id).single()
    if (error || !user?.certificate_path) return res.status(404).json({ error: 'No certificate on file' })
    const { data, error: signError } = await supabase.storage
      .from(CERTIFICATE_BUCKET).createSignedUrl(user.certificate_path, 10 * 60)
    if (signError) return fail(res, 400, 'Could not open the certificate', signError)
    await logAdminAction(req.userId, 'open_certificate', { targetType: 'user', targetId: Number(req.params.id) })
    res.json({ url: data.signedUrl })
  } catch (e) {
    res.status(500).json({ error: 'Could not open the certificate' })
  }
})

// An admin removes a certificate that is not what it claims. The member can
// upload another.
router.delete('/users/:id/certificate', async (req, res) => {
  try {
    await supabase.storage.from(CERTIFICATE_BUCKET).remove(certificatePaths(req.params.id))
    const { error } = await supabase
      .from('users')
      .update({ certificate_path: null, certificate_name: null, certificate_uploaded_at: null })
      .eq('id', req.params.id)
    if (error) return fail(res, 400, 'Could not remove the certificate', error)
    await logAdminAction(req.userId, 'remove_certificate', { targetType: 'user', targetId: Number(req.params.id) })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not remove the certificate' })
  }
})

// POST /api/admin/users/:id/lift-no-show — the member disputed a no-show
// and the admin agrees: lift both limits and undo the strikes. Refunds and
// cancellations that already happened stay as they are.
router.post('/users/:id/lift-no-show', async (req, res) => {
  try {
    const { error } = await supabase.from('users').update({ teaching_paused_until: null, booking_limited_until: null }).eq('id', req.params.id)
    if (error) return fail(res, 400, 'Could not lift the limits', error)
    await supabase.from('no_show_events').update({ undone_at: new Date().toISOString() }).eq('user_id', req.params.id).is('undone_at', null)
    await logAdminAction(req.userId, 'lift_no_show', { targetType: 'user', targetId: Number(req.params.id) })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not lift the limits' })
  }
})

// POST /api/admin/users/:id/credit — manual grant (support cases, goodwill,
// etc). Mirrors the exact balance-update + audit-row shape every other
// credit change already uses (see routes/enrollments.js) rather than a
// separate code path. Logged as 'bonus', the type invite bananas use
// (migrations/add_referrals.sql): it used to be 'earned', which
// creditSpendGate reads as "has taught", so a top-up unlocked a member's
// last banana without them ever teaching.
router.post('/users/:id/credit', async (req, res) => {
  const amount = parseInt(req.body.amount)
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive whole number' })
  }
  try {
    // Atomic add so a grant can't lose a concurrent spend/grant. NULL means
    // the user has no credits row.
    const { data: newBalance, error } = await supabase
      .rpc('add_credit', { p_user_id: req.params.id, p_amount: amount })
    if (error) return fail(res, 400, 'Could not add credit', error)
    if (newBalance === null) return res.status(404).json({ error: 'User not found' })

    await recordCreditTransaction(supabase, {
      user_id: req.params.id,
      amount,
      type: 'bonus',
      description: req.body.description || 'Credit added by admin'
    })

    // Same "balance went up" case resetLowCreditNotificationIfToppedUp
    // already covers for teaching/attendance credit — an admin grant that
    // clears the threshold should clear the flag too.
    await resetLowCreditNotificationIfToppedUp(req.params.id, newBalance)

    const rows = [{
      user_id: req.params.id,
      type: 'credit_added',
      message: `You received ${amount} credit${amount === 1 ? '' : 's'}`
    }]
    await supabase.from('notifications').insert(rows)
    pushNotifications(rows)

    await logAdminAction(req.userId, 'give_bananas', { targetType: 'user', targetId: Number(req.params.id), detail: { amount } })
    res.json({ success: true, balance: newBalance })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not add credit' })
  }
})

// POST /api/admin/users/:id/suspend
// A permanent ban is a far-future `until`, not a separate flag — two columns
// can disagree about whether someone is banned, one cannot.
// An admin can't suspend or delete themselves or another admin: one test
// report against the owner's own account suspended it for 30 days
// (2026-11-17). Change ADMIN_EMAILS first if that is ever really meant.
async function protectedAccount(req, userId) {
  if (userId === req.userId) return 'You cannot do this to your own account'
  if (await isAdmin(userId)) return 'This is an admin account; remove it from ADMIN_EMAILS first'
  return null
}

router.post('/users/:id/suspend', async (req, res) => {
  const { until, reason } = req.body
  const userId = parseInt(req.params.id)
  if (!userId) return res.status(400).json({ error: 'Invalid user id' })
  const blocked = await protectedAccount(req, userId)
  if (blocked) return res.status(400).json({ error: blocked })

  const endsAt = new Date(until)
  if (!until || Number.isNaN(endsAt.getTime())) {
    return res.status(400).json({ error: 'A valid end date is required' })
  }
  if (endsAt <= new Date()) {
    return res.status(400).json({ error: 'The end date must be in the future' })
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'A reason is required' })
  }

  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, email, first_name, deleted_at')
      .eq('id', userId)
      .single()

    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.deleted_at) return res.status(400).json({ error: 'That account is already deleted' })

    const { data, error } = await supabase
      .from('users')
      .update({
        suspended_until: endsAt.toISOString(),
        suspension_reason: String(reason).trim(),
        // Kills every token already issued. Without this a suspended user
        // with an open tab keeps working until their JWT expires, which is
        // not a suspension.
        token_valid_after: new Date().toISOString()
      })
      .eq('id', userId)
      .select('id, suspended_until, suspension_reason')
      .single()

    if (error) return fail(res, 400, 'Could not suspend this account', error)

    // A suspended teacher cannot run the classes they are booked for, so the
    // ones inside the suspension window are cancelled and their students
    // refunded. Leaving them standing put a class on a student's dashboard
    // that nobody could turn up to teach.
    //
    // Only inside the window: a class after the suspension ends is one the
    // teacher will be back for, and cancelling it would punish the students
    // for something already handled.
    const classes = await cancelTeacherClasses(supabase, userId, { before: endsAt, byPlatform: true })

    // Someone locked out with no explanation files a support request, and
    // answering that by hand is worse than sending the mail.
    await sendEmail({
      to: user.email,
      subject: 'Your GongbuLeng account has been suspended',
      ...renderEmail({
        heading: 'Your account has been suspended',
        paragraphs: [
          `Hi ${user.first_name}, your GongbuLeng account has been suspended.`,
          classes.cancelled ? `${classes.cancelled} of your upcoming class(es) have been cancelled and the students refunded.` : '',
          `If you believe this is a mistake, write to ${CONTACT}.`,
        ],
        box: [['Until:', endsAt.toUTCString()], ['Reason:', String(reason).trim()]],
      }),
    }).catch(e => console.error('[SUSPEND] Notification email failed', e.message))

    await logAdminAction(req.userId, 'suspend', { targetType: 'user', targetId: Number(req.params.id), detail: { until: data?.suspended_until, reason: String(reason).trim() } })
    res.json({ ...data, classes_cancelled: classes.cancelled, students_refunded: classes.refunded })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not suspend this account' })
  }
})

// POST /api/admin/users/:id/unsuspend
// token_valid_after is deliberately left where the suspension put it.
// Bumping it logged them out; leaving it bumped just means signing in again.
router.post('/users/:id/unsuspend', async (req, res) => {
  const userId = parseInt(req.params.id)
  if (!userId) return res.status(400).json({ error: 'Invalid user id' })

  try {
    const { data, error } = await supabase
      .from('users')
      .update({ suspended_until: null, suspension_reason: null })
      .eq('id', userId)
      .select('id, suspended_until')
      .single()

    if (error) return fail(res, 400, 'Could not lift the suspension', error)
    if (!data) return res.status(404).json({ error: 'User not found' })
    await logAdminAction(req.userId, 'unsuspend', { targetType: 'user', targetId: Number(req.params.id) })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not lift the suspension' })
  }
})

// POST /api/admin/users/:id/delete
// Runs the same sequence a member's own deletion runs, so a deleted
// teacher's students still get their classes cancelled and their credits
// refunded. Irreversible, and it sits inches from Suspend, which is not —
// so it takes the user's own code typed back rather than a single click.
router.post('/users/:id/delete', async (req, res) => {
  const userId = parseInt(req.params.id)
  if (!userId) return res.status(400).json({ error: 'Invalid user id' })
  const blocked = await protectedAccount(req, userId)
  if (blocked) return res.status(400).json({ error: blocked })

  const expected = 'U' + String(userId).padStart(6, '0')
  if (req.body.confirm !== expected) {
    return res.status(400).json({ error: `Type ${expected} to confirm` })
  }

  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, email, first_name, deleted_at')
      .eq('id', userId)
      .single()

    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.deleted_at) return res.status(400).json({ error: 'That account is already deleted' })

    const result = await deleteAccount(supabase, user)
    if (!result.ok) return fail(res, 500, 'Could not delete this account', result.error)
    await logAdminAction(req.userId, 'delete_member', { targetType: 'user', targetId: Number(userId) })

    res.json({ deleted: userId })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not delete this account' })
  }
})

module.exports = router
