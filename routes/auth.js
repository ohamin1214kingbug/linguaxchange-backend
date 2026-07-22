const express = require('express')
const router = express.Router()
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('../utils/mailer')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FRONTEND_URL = 'https://linguaxchange-frontend.vercel.app'
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, first_name, last_name, nationality } = req.body

  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email' })
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
  if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name are required' })

  try {
    const password_hash = await bcrypt.hash(password, 10)

    const { data: newUser, error } = await supabase
      .from('users')
      .insert([{ email, password_hash, first_name, last_name, nationality }])
      .select('id, email, first_name')
      .single()

    if (error) return res.status(400).json({ error: error.message })

    await supabase
      .from('credits')
      .insert([{ user_id: newUser.id, balance: 1 }])

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

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' })

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single()

    if (error || !user) {
      return res.status(401).json({ error: 'User not found' })
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash)

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Wrong password' })
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
  const { email, name, google_id } = req.body

  if (!email) return res.status(400).json({ error: 'Email required' })

  try {
    // Check if user already exists
    const { data: existing } = await supabase
      .from('users')
      .select('id, email, first_name, is_approved')
      .eq('email', email)
      .maybeSingle()

    let user = existing

    if (!user) {
      const nameParts = (name || '').split(' ')
      const first_name = nameParts[0] || ''
      const last_name = nameParts.slice(1).join(' ') || ''

      const { data: newUser, error } = await supabase
        .from('users')
        .insert([{ email, first_name, last_name, google_id, is_approved: false }])
        .select('id, email, first_name, is_approved')
        .single()

      if (error) return res.status(400).json({ error: error.message })

      await supabase
        .from('credits')
        .insert([{ user_id: newUser.id, balance: 1 }])

      await sendEmail({
        to: email,
        subject: 'Welcome to LinguaXchange!',
        text: `Hi ${first_name}, welcome to LinguaXchange! Your account is pending admin approval — we'll notify you once it's ready.`
      })

      user = newUser
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({ token, user })
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

    const emailResult = await sendEmail({
      to: email,
      subject: 'Reset your LinguaXchange password',
      text: `Hi ${user.first_name}, click this link to reset your password: ${FRONTEND_URL}/auth/reset-password?token=${rawToken}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`
    })

    res.json({ ...genericResponse, debugEmailResult: emailResult })
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

    await supabase
      .from('users')
      .update({ password_hash, reset_token: null, reset_token_expires: null })
      .eq('id', user.id)

    res.json({ message: 'Password updated successfully' })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Could not reset password' })
  }
})

module.exports = router