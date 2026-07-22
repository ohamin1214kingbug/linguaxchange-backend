const express = require('express')
const cors = require('cors')
require('dotenv').config()

const authRoutes = require('./routes/auth')
const classRoutes = require('./routes/classes')
const creditRoutes = require('./routes/credits')
const adminRoutes = require('./routes/admin')
const enrollmentRoutes = require('./routes/enrollments')
const reviewRoutes = require('./routes/reviews')
const userRoutes = require('./routes/users')
const videoRoutes = require('./routes/video')

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/classes', classRoutes)
app.use('/api/credits', creditRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/enrollments', enrollmentRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/users', userRoutes)
app.use('/api/video', videoRoutes)

app.get('/api/_debug/resend-key', (req, res) => {
  const raw = process.env.RESEND_API_KEY
  res.json({
    present: raw !== undefined,
    length: raw ? raw.length : 0,
    looksLikeResendKey: raw ? raw.startsWith('re_') : false,
    hasWhitespace: raw ? /\s/.test(raw) : null,
    envKeyNamesContainingResend: Object.keys(process.env).filter(k => k.toLowerCase().includes('resend'))
  })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})