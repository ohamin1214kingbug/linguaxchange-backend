const { sendEmail } = require('./mailer')
const { renderEmail } = require('./emailTemplate')
const { FRONTEND_URL } = require('./frontendUrl')
const { createClient } = require('@supabase/supabase-js')

// Created on first use, like utils/referrals.js: modules that only send the
// first-class email (and their tests) never need a database client.
let client
const db = () => (client ||= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY))

// Same source of truth requireAdmin/isAdmin use in middleware/auth.js —
// keeping admin identity in one env var means adding/removing an admin
// doesn't require touching multiple files.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean)

// A new teacher's first class went live (owner decision, 2026-11-19: no
// approval step). The admin looks at it and can hide it from /admin
// (classes are rejected there, which takes them off Explore). Best effort.
async function notifyAdminsOfFirstClass(teacher, cls) {
  const name = [teacher?.first_name, teacher?.last_name].filter(Boolean).join(' ') || 'A member'
  for (const adminEmail of ADMIN_EMAILS) {
    try {
      await sendEmail({
        to: adminEmail,
        subject: `New teacher: ${name} posted their first class`,
        ...renderEmail({
          heading: "A new teacher's first class is live",
          paragraphs: [
            `${name} (${teacher?.email || 'no email'}) just posted their first class, and it is already public.`,
            'Have a quick look. If it is not OK, hide it from the admin page.',
          ],
          box: [['Class:', cls.title], ['Language:', `${cls.language_code} · ${cls.level}`]],
          button: { label: 'See the class', url: `${FRONTEND_URL}/classes/${cls.id}` },
          footnote: `Hide it: ${FRONTEND_URL}/admin (Classes)`,
        }),
      })
    } catch (e) {
      console.error('[ADMIN_NOTIFY] Failed to notify', adminEmail, e.message)
    }
  }
}

// A new member finished signing up (owner request, 2026-11-19): sent when
// the phone is verified, so a Google signup that stops at the phone step
// doesn't count. Not an approval request; there is no approval step.
async function notifyAdminsOfNewMember(user, { method, referred_by } = {}) {
  const [{ count }, { data: inviter }] = await Promise.all([
    db().from('users').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    referred_by ? db().from('users').select('first_name').eq('id', referred_by).maybeSingle() : Promise.resolve({ data: null }),
  ]).catch(() => [{}, {}])
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'A new member'
  const box = [['Email:', user.email], ['Signed up with:', method === 'google' ? 'Google' : 'email']]
  if (inviter) box.push(['Invited by:', inviter.first_name || `member ${referred_by}`])
  if (count) box.push(['Members now:', String(count)])
  for (const adminEmail of ADMIN_EMAILS) {
    try {
      await sendEmail({
        to: adminEmail,
        subject: `New member: ${name}`,
        ...renderEmail({
          heading: 'A new member joined 🎉',
          paragraphs: [`${name} just finished signing up (phone verified).`],
          box,
          button: { label: 'See members', url: `${FRONTEND_URL}/admin` },
        }),
      })
    } catch (e) {
      console.error('[ADMIN_NOTIFY] Failed to notify', adminEmail, e.message)
    }
  }
}

// Someone's phone country is off in Twilio Verify's Geo Permissions (error
// 60605; owner request, 2026-11-24). One email per person and at most 10 a
// day, so every real member reaches the admin but a burst of fake sign-ups
// can't flood the inbox.
// ponytail: in-memory, so it resets on each deploy; fine on one Railway instance.
const BLOCKED_PER_DAY = 10
let blockedDay = ''
let blockedSeen = new Set()
function takeBlockedSlot(key, now = new Date()) {
  const day = now.toISOString().slice(0, 10)
  if (day !== blockedDay) { blockedDay = day; blockedSeen = new Set() }
  if (blockedSeen.has(key) || blockedSeen.size >= BLOCKED_PER_DAY) return false
  blockedSeen.add(key)
  return true
}

function countryName(code) {
  if (!/^[A-Z]{2}$/.test(code || '')) return 'an unknown country'
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) } catch { return code }
}

async function notifyAdminsOfBlockedCountry({ country, email, method, key }) {
  if (!takeBlockedSlot(key || email || 'unknown')) return false
  const name = countryName(country)
  const where = /^[A-Z]{2}$/.test(country || '') ? `${name} (${country})` : name
  const box = [
    ['Country:', where],
    ['Signed up with:', method === 'google' ? 'Google' : 'email'],
    ['Their email:', email || 'not given'],
    ['When:', new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' }) + ' (Madrid)'],
  ]
  const next = method === 'google' ? '/auth/login' : '/auth/register'
  const reply = email && `mailto:${email}?subject=${encodeURIComponent('You can sign up on GongbuLeng now')}&body=${encodeURIComponent(
    `Hi! We've switched on text messages to ${name}, so you can verify your phone now: ${FRONTEND_URL}${next}\n\nSee you in class,\nThe GongbuLeng team`)}`
  for (const adminEmail of ADMIN_EMAILS) {
    try {
      await sendEmail({
        to: adminEmail,
        subject: `📵 Someone couldn't get a phone code: ${where}`,
        ...renderEmail({
          heading: "Someone couldn't get a phone code",
          paragraphs: [`A new member tried to verify their phone, but Twilio doesn't send codes to ${name}.`],
          box,
          button: reply ? { label: 'Reply: "You can sign up now"', url: reply } : undefined,
          footnote: `To let them in: Twilio → Verify → Fraud & Geo Permissions → Geo Permissions → ${name} → SMS & RCS: Allow All Traffic. Then reply to them. If the same person tries again, no second email; at most ${BLOCKED_PER_DAY} of these a day.`,
        }),
      })
    } catch (e) {
      console.error('[ADMIN_NOTIFY] Failed to notify', adminEmail, e.message)
    }
  }
  return true
}

module.exports = { notifyAdminsOfFirstClass, notifyAdminsOfNewMember, notifyAdminsOfBlockedCountry }
