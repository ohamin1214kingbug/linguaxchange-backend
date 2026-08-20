const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
require('dotenv').config()

const authRoutes = require('./routes/auth')
const classRoutes = require('./routes/classes')
const creditRoutes = require('./routes/credits')
const adminRoutes = require('./routes/admin')
const enrollmentRoutes = require('./routes/enrollments')
const reviewRoutes = require('./routes/reviews')
const userRoutes = require('./routes/users')
const videoRoutes = require('./routes/video')
const cronRoutes = require('./routes/cron')
const notificationRoutes = require('./routes/notifications')
const studentFeedbackRoutes = require('./routes/studentFeedback')
const classRequestRoutes = require('./routes/classRequests')
const reportRoutes = require('./routes/reports')
const savedTeacherRoutes = require('./routes/savedTeachers')
const accountRoutes = require('./routes/account')

const app = express()

// Railway terminates TLS and proxies requests through a single hop, so trust
// exactly one layer of X-Forwarded-For — needed for rate limiting (and
// req.ip generally) to see the real client IP instead of Railway's own.
app.set('trust proxy', 1)

app.use(helmet())

// Only the actual frontends should be able to call this API from a
// browser — cors() with no options reflects any origin, which lets any
// website script requests against this API using a visitor's own browser.
const ALLOWED_ORIGINS = [
  'https://linguaxchange.com',
  'https://www.linguaxchange.com',
  'https://linguaxchange-frontend.vercel.app',
  'http://localhost:3000'
]
app.use(cors({
  origin: (origin, callback) => {
    // No Origin header (server-to-server calls, curl, the cron pinger) —
    // let it through since there's no browser same-origin policy to enforce.
    // Reject with `false` rather than an Error — CORS is enforced by the
    // browser refusing to read the response, not by the server blocking
    // it, so there's nothing to 500 over. An Error here would just leak a
    // stack trace instead of the standard "no CORS headers" outcome.
    callback(null, !origin || ALLOWED_ORIGINS.includes(origin))
  }
}))

// Base64 uploads (avatar images, class materials PDFs) need more headroom
// than every other route's JSON body. A second stacked express.json() would
// try to re-read the same (already-consumed) request stream, so pick one
// parser per request instead of chaining two.
//
// 14mb covers a 10MB PDF: base64 inflates by ~33%, so the encoded body is
// larger than the file the teacher picked.
const uploadJsonParser = express.json({ limit: '14mb' })
const defaultJsonParser = express.json({ limit: '100kb' })
const UPLOAD_PATHS = ['/api/users', '/api/classes']
app.use((req, res, next) => {
  const parser = UPLOAD_PATHS.some(p => req.path.startsWith(p)) ? uploadJsonParser : defaultJsonParser
  parser(req, res, next)
})

app.use('/api/auth', authRoutes)
app.use('/api/classes', classRoutes)
app.use('/api/credits', creditRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/enrollments', enrollmentRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/users', userRoutes)
app.use('/api/video', videoRoutes)
app.use('/api/cron', cronRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/student-feedback', studentFeedbackRoutes)
app.use('/api/class-requests', classRequestRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/saved-teachers', savedTeacherRoutes)
app.use('/api/account', accountRoutes)

// Oversized bodies (e.g. a >5MB avatar) get rejected by body-parser before
// any route handler runs, and Express's default error page for that is an
// HTML stack trace — surface it as JSON like every other error response.
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Image must be under 5MB' })
  }
  next(err)
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})