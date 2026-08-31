const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { verifyEmailLimiter, publicGetLimiter } = require('../middleware/rateLimit')
const { matchDomain } = require('../utils/universityDomains')
const { sendEmail } = require('../utils/mailer')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const FRONTEND_URL = 'https://linguaxchange-frontend.vercel.app'
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

// GET /api/university/domains — which universities can be verified. Public:
// the settings page shows it before anyone submits anything.
router.get('/domains', publicGetLimiter, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('university_domains')
      .select('domain, name')
      .order('name')
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not fetch universities' })
  }
})

// POST /api/university/verify — send a confirmation link.
//
// The response never reveals whether the address already belongs to another
// account. Otherwise this becomes a way to test which university addresses
// have accounts here — the same enumeration the password-reset flow refuses.
router.post('/verify', requireAuth, verifyEmailLimiter, async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const genericResponse = { message: 'If that address can be verified, a confirmation email has been sent.' }

  try {
    const { data: allowlist } = await supabase
      .from('university_domains')
      .select('domain, name')

    const matched = matchDomain(email, allowlist || [])
    // An unknown domain is the one case worth naming: the member needs to know
    // to ask for their university rather than assume the site is broken.
    if (!matched) {
      return res.status(400).json({ error: 'That university is not supported yet. Ask us to add it.' })
    }

    // Someone has already proven they own this address. Answer as if the mail
    // were sent — saying so would turn this into a way to test which
    // university addresses have accounts here.
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('university_email', email)
      .maybeSingle()
    if (existing && existing.id !== req.userId) return res.json(genericResponse)

    const rawToken = crypto.randomBytes(32).toString('hex')
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex')

    const { error } = await supabase
      .from('users')
      .update({
        // Pending, not claimed. Writing university_email here would let anyone
        // park a stranger's address in their own row and, through the unique
        // index, block the real owner from ever verifying it — with no error
        // either of them could see.
        university_pending_email: email,
        university_token: hashedToken,
        university_token_expires: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      })
      .eq('id', req.userId)
    if (error) return res.status(400).json({ error: error.message })

    await sendEmail({
      to: email,
      subject: 'Confirm your university email — LinguaXchange',
      text: `Confirm that this address belongs to you: ${FRONTEND_URL}/university/confirm?token=${rawToken}\n\nThis link expires in 24 hours. If you didn't ask for this, you can ignore this email.`
    })

    res.json(genericResponse)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not send the confirmation email' })
  }
})

// POST /api/university/confirm — redeem the token. Public, because the person
// clicking the link may not be signed in on that device. The token is the
// credential.
router.post('/confirm', async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : ''
  if (!token) return res.status(400).json({ error: 'Missing token' })

  try {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex')

    const { data: user } = await supabase
      .from('users')
      .select('id, university_pending_email, university_token_expires')
      .eq('university_token', hashedToken)
      .maybeSingle()

    if (!user || !user.university_token_expires || new Date(user.university_token_expires) < new Date()) {
      return res.status(400).json({ error: 'That link is invalid or has expired.' })
    }

    const pending = user.university_pending_email
    if (!pending) return res.status(400).json({ error: 'That link is invalid or has expired.' })

    const domain = pending.slice(pending.lastIndexOf('@') + 1)
    const { data: uni } = await supabase
      .from('university_domains')
      .select('name')
      .eq('domain', domain)
      .maybeSingle()

    // The claim happens here, where ownership has just been proven. The unique
    // index is what settles a race between two people holding tokens for the
    // same address: the first to confirm keeps it, the second is told plainly
    // rather than silently failing.
    const { error } = await supabase
      .from('users')
      .update({
        university_email: pending,
        university_pending_email: null,
        university_domain: domain,
        university_verified_at: new Date().toISOString(),
        university_token: null,
        university_token_expires: null,
      })
      .eq('id', user.id)

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'That address has already been verified by another account.' })
      }
      return res.status(400).json({ error: error.message })
    }

    res.json({ success: true, university: uni?.name || domain })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not confirm that address' })
  }
})

module.exports = router
