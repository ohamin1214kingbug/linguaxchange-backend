const express = require('express')
const router = express.Router()
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('../utils/mailer')
const { notifyAdminsOfPendingUser } = require('../utils/adminNotify')
const { loginLimiter, registerLimiter, otpSendLimiter, otpCheckLimiter } = require('../middleware/rateLimit')
const { sendOtp, checkOtp, isValidPhoneNumber, otpErrorKey } = require('../utils/phoneVerify')
const { phoneAccountLimitReached } = require('../utils/phoneAccountLimit')
const { requireAuth } = require('../middleware/auth')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const { FRONTEND_URL } = require('../utils/frontendUrl')
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000
// Long enough to finish the rest of the registration form after verifying,
// short enough that a leaked token can't be replayed much later.
const PHONE_VERIFIED_TOKEN_TTL = '15m'
// Enough to attend a few classes before a new user hits 0 and needs to
// teach (or buy, once that exists) to keep participating.
const SIGNUP_CREDIT_GRANT = 3

// POST /api/auth/register
router.post('/register', registerLimiter, async (req, res) => {
  const { email, password, first_name, last_name, nationality, phone_number, verified_token } = req.body

  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email' })
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
  if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name are required' })

  // Require proof of the phone-verification step (see /send-otp, /verify-otp)
  // rather than trusting a client-supplied "verified" flag directly.
  if (!phone_number || !verified_token) {
    return res.status(400).json({ error: 'Phone verification is required' })
  }
  try {
    const payload = jwt.verify(verified_token, process.env.JWT_SECRET)
    if (payload.purpose !== 'phone_verified' || payload.phone_number !== phone_number) {
      return res.status(400).json({ error: 'Phone verification does not match' })
    }
  } catch (e) {
    return res.status(400).json({ error: 'Phone verification has expired. Please verify again.' })
  }

  try {
    if (await phoneAccountLimitReached(phone_number)) {
      return res.status(400).json({ error: 'This phone number has already been used for the maximum number of accounts.' })
    }

    const password_hash = await bcrypt.hash(password, 10)

    const { data: newUser, error } = await supabase
      .from('users')
      .insert([{ email, password_hash, first_name, last_name, nationality, phone_number, phone_verified: true }])
      .select('id, email, first_name')
      .single()

    if (error) {
      // Signing up with an address that already exists is the one failure
      // here a normal person hits, and it arrives as a Postgres unique
      // violation whose raw message names the table and constraint.
      // Returning error.message verbatim handed that schema detail to
      // anyone who typed their own email twice.
      if (error.code === '23505') {
        return res.status(400).json({ error: 'That email is already registered' })
      }
      console.error(error)
      return res.status(400).json({ error: 'Could not create your account' })
    }

    await supabase
      .from('credits')
      .insert([{ user_id: newUser.id, balance: SIGNUP_CREDIT_GRANT }])

    await notifyAdminsOfPendingUser(newUser)

    const token = jwt.sign(
      { userId: newUser.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.status(201).json({ token, user: newUser })

  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Registration failed' })
  }
})

// POST /api/auth/send-otp — first half of phone verification. Shared by
// email/password signup (/register) and Google signup (/add-phone), since
// Google verifies identity but not phone ownership.
router.post('/send-otp', otpSendLimiter, async (req, res) => {
  const { phone_number } = req.body
  if (!isValidPhoneNumber(phone_number)) {
    return res.status(400).json({ error: 'Enter a valid phone number in international format, e.g. +14155551234' })
  }

  const result = await sendOtp(phone_number)
  if (!result.ok) {
    // Log the code alongside the prose: the code is what's greppable and
    // lookup-able when this fails in production.
    console.error('[SEND_OTP]', result.code || '-', result.error)
    const key = otpErrorKey(result.code)
    // 503 when it's our side, so "can't send right now" isn't logged as the
    // visitor submitting something invalid.
    return res.status(key === 'auth.otpUnavailable' ? 503 : 400).json({ error: key })
  }
  res.json({ success: true })
})

// POST /api/auth/verify-otp — second half. Twilio consumes the code on
// check rather than persisting a "verified" flag, so on success this signs
// a short-lived token binding that specific phone number; /register
// requires and re-verifies this token rather than trusting a client-supplied
// "I verified" boolean.
router.post('/verify-otp', otpCheckLimiter, async (req, res) => {
  const { phone_number, code } = req.body
  if (!isValidPhoneNumber(phone_number) || !code) {
    return res.status(400).json({ error: 'Phone number and code are required' })
  }

  const result = await checkOtp(phone_number, code)
  if (!result.ok) {
    return res.status(400).json({ error: 'Invalid or expired code' })
  }

  const verified_token = jwt.sign(
    { phone_number, purpose: 'phone_verified' },
    process.env.JWT_SECRET,
    { expiresIn: PHONE_VERIFIED_TOKEN_TTL }
  )
  res.json({ verified_token })
})

// POST /api/auth/add-phone — completes phone verification for an
// already-authenticated Google account (see /google-login, which defers
// the credit grant until this succeeds). Same verified_token contract as
// /register: proof comes from /verify-otp, never a client-supplied flag.
// GET /api/auth/me — the caller's own account flags.
//
// GET /api/users/:id is public and returns PUBLIC_FIELDS to anyone, so it
// cannot carry phone_verified: whether someone confirmed a phone number is
// nobody else's business. This is the authed "who am I" the app was missing —
// its absence is why the settings page was reading account state off the
// cached login payload, which holds only id, email and first_name.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, first_name, phone_verified, university_domain, university_verified_at, deleted_at')
      .eq('id', req.userId)
      .single()
    if (error || !data || data.deleted_at) return res.status(404).json({ error: 'User not found' })
    const { deleted_at, ...me } = data
    res.json(me)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not fetch your account' })
  }
})

router.post('/add-phone', requireAuth, otpCheckLimiter, async (req, res) => {
  const { phone_number, verified_token } = req.body
  if (!phone_number || !verified_token) {
    return res.status(400).json({ error: 'Phone verification is required' })
  }
  try {
    const payload = jwt.verify(verified_token, process.env.JWT_SECRET)
    if (payload.purpose !== 'phone_verified' || payload.phone_number !== phone_number) {
      return res.status(400).json({ error: 'Phone verification does not match' })
    }
  } catch (e) {
    return res.status(400).json({ error: 'Phone verification has expired. Please verify again.' })
  }

  try {
    if (await phoneAccountLimitReached(phone_number)) {
      return res.status(400).json({ error: 'This phone number has already been used for the maximum number of accounts.' })
    }

    const { data: updated, error } = await supabase
      .from('users')
      .update({ phone_number, phone_verified: true })
      .eq('id', req.userId)
      .select('id, email, first_name, is_approved, phone_verified')
      .single()

    if (error) return res.status(400).json({ error: error.message })

    const { data: existingCredit } = await supabase
      .from('credits')
      .select('user_id')
      .eq('user_id', req.userId)
      .maybeSingle()

    if (!existingCredit) {
      await supabase
        .from('credits')
        .insert([{ user_id: req.userId, balance: SIGNUP_CREDIT_GRANT }])
    }

    res.json({ user: updated })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not verify phone number' })
  }
})

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' })

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single()

    // One message for both failure modes. Distinguishing "User not found"
    // from "Wrong password" turns this endpoint into an account-existence
    // oracle: submit any email with a junk password and the reply says
    // whether that person has an account here. forgot-password already
    // guards against this by answering identically either way; login did
    // not, which made the guard there pointless.
    //
    // A timing difference remains — the missing-user path skips bcrypt and
    // so returns sooner. loginLimiter caps attempts, which makes measuring
    // it impractical.
    // ponytail: message-only fix, equalise with a dummy bcrypt compare if
    // the rate limiter is ever loosened.
    const INVALID = 'Invalid email or password'

    if (error || !user) {
      return res.status(401).json({ error: INVALID })
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash)

    if (!passwordMatch) {
      return res.status(401).json({ error: INVALID })
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({
      token,
      user: { id: user.id, email: user.email, first_name: user.first_name }
    })

  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Login failed' })
  }
})

// POST /api/auth/google-login
router.post('/google-login', async (req, res) => {
  const { access_token } = req.body

  if (!access_token) return res.status(400).json({ error: 'access_token required' })

  try {
    // Never trust a client-supplied email/name/google_id directly — that
    // would let anyone log in as any existing account just by knowing
    // their email. Independently verify the Supabase-issued session token
    // instead, and derive identity only from what Supabase confirms.
    const { data: verified, error: verifyError } = await supabase.auth.getUser(access_token)
    if (verifyError || !verified?.user?.email) {
      return res.status(401).json({ error: 'Invalid or expired session' })
    }

    const email = verified.user.email
    const name = verified.user.user_metadata?.full_name
    const google_id = verified.user.id

    // Check if user already exists
    const { data: existing } = await supabase
      .from('users')
      .select('id, email, first_name, is_approved, phone_verified')
      .eq('email', email)
      .maybeSingle()

    let user = existing
    const isNewUser = !existing

    if (!user) {
      const nameParts = (name || '').split(' ')
      const first_name = nameParts[0] || ''
      const last_name = nameParts.slice(1).join(' ') || ''

      // No credit grant yet — Google already verifies identity, but not
      // phone ownership, so someone could otherwise farm the signup credit
      // grant across unlimited disposable Google accounts. The credits row
      // is created by POST /add-phone once they verify a real number (and
      // that number hasn't already hit phoneAccountLimitReached).
      const { data: newUser, error } = await supabase
        .from('users')
        .insert([{ email, first_name, last_name, google_id, is_approved: false, phone_verified: false }])
        .select('id, email, first_name, is_approved, phone_verified')
        .single()

      if (error) return res.status(400).json({ error: error.message })

      await sendEmail({
        to: email,
        subject: 'Welcome to LinguaXchange!',
        text: `Hi ${first_name}, welcome to LinguaXchange! Your account is pending admin approval — we'll notify you once it's ready.`
      })

      await notifyAdminsOfPendingUser(newUser)

      user = newUser
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({ token, user, isNewUser })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Google login failed' })
  }
})

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email is required' })

  const genericResponse = { message: 'If that email exists, a reset link has been sent.' }

  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, first_name, password_hash')
      .eq('email', email)
      .maybeSingle()

    // Only users with a password (not Google-only accounts) can reset a password
    if (!user || !user.password_hash) return res.json(genericResponse)

    const rawToken = crypto.randomBytes(32).toString('hex')
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex')
    const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS)

    await supabase
      .from('users')
      .update({ reset_token: hashedToken, reset_token_expires: expires.toISOString() })
      .eq('id', user.id)

    await sendEmail({
      to: email,
      subject: 'Reset your LinguaXchange password',
      text: `Hi ${user.first_name}, click this link to reset your password: ${FRONTEND_URL}/auth/reset-password?token=${rawToken}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`
    })

    res.json(genericResponse)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Could not process request' })
  }
})

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body
  if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' })
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })

  try {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex')

    const { data: user } = await supabase
      .from('users')
      .select('id, reset_token_expires')
      .eq('reset_token', hashedToken)
      .maybeSingle()

    if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired' })
    }

    const password_hash = await bcrypt.hash(password, 10)

    // Invalidates any token issued before now — a leaked/stolen token
    // stops working the moment the real owner resets their password.
    await supabase
      .from('users')
      .update({ password_hash, reset_token: null, reset_token_expires: null, token_valid_after: new Date().toISOString() })
      .eq('id', user.id)

    res.json({ message: 'Password updated successfully' })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Could not reset password' })
  }
})

// POST /api/auth/change-password — requires the CURRENT password, not just
// a valid session. Tokens live in localStorage, so if one ever leaks, this
// re-auth is the only thing between "attacker has your token" and "attacker
// has locked you out of your own account". Rate-limited with the login
// limiter since a wrong-password loop here is the same guessing attack.
router.post('/change-password', requireAuth, loginLimiter, async (req, res) => {
  const { current_password, new_password } = req.body

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password are required' })
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  try {
    const { data: user } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', req.userId)
      .single()

    // Google-only accounts have no password_hash — nothing to verify or replace.
    if (!user?.password_hash) {
      return res.status(400).json({ error: 'This account signs in with Google, so it has no password to change' })
    }

    if (!(await bcrypt.compare(current_password, user.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' })
    }

    // Zeroed to the second before signing: jwt's `iat` claim is whole
    // seconds, so a cutoff still carrying milliseconds would sit *after*
    // the new token's iat and instantly invalidate the token we're about
    // to hand back. See tests/passwordChangeCutoff.test.js.
    const cutoff = new Date()
    cutoff.setMilliseconds(0)

    await supabase
      .from('users')
      .update({
        password_hash: await bcrypt.hash(new_password, 10),
        token_valid_after: cutoff.toISOString()
      })
      .eq('id', req.userId)

    // Every previously-issued token is now dead, including this request's.
    // Hand back a fresh one so changing your password doesn't log you out
    // of the device you changed it on — only the other ones.
    const token = jwt.sign({ userId: req.userId }, process.env.JWT_SECRET, { expiresIn: '7d' })

    res.json({ token, message: 'Password updated. Other devices have been signed out.' })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Could not change password' })
  }
})

// POST /api/auth/logout — bumps token_valid_after so this (and every
// other) token issued before now stops working, not just the client's
// local copy. See middleware/auth.js requireAuth.
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await supabase
      .from('users')
      .update({ token_valid_after: new Date().toISOString() })
      .eq('id', req.userId)
    res.json({ success: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Could not log out' })
  }
})

module.exports = router