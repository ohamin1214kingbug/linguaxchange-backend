// Pin the process to UTC before anything constructs a Date.
//
// This was load-bearing until 2026-09-01. Every timestamp column was
// `timestamp without time zone`, so values came back with no offset, and a
// date-time string without one is parsed as LOCAL time per the JS spec.
// Every `new Date(session_date)` — the attendance window, the cancellation
// refund cutoff, every "is this class upcoming" check — was silently
// shifted by the host's UTC offset, and production was correct only because
// Railway runs UTC.
//
// All 35 timestamp columns are timestamptz now (session_date_to_timestamptz
// .sql and remaining_naive_timestamps_to_timestamptz.sql), so every value
// carries its offset and parses correctly on any host.
//
// Kept anyway. It costs one line, nothing here reads server local time (no
// toLocale*, no getHours), and it makes the process behave identically
// wherever it runs — including for any bare date string a future column or
// third-party payload introduces. Remove it only alongside a check that
// nothing has reintroduced a naive timestamp.
process.env.TZ = 'UTC'

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
const resourceRoutes = require('./routes/resources')
const universityRoutes = require('./routes/university')
const recordRoutes = require('./routes/records')
const assignmentRoutes = require('./routes/assignments')

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
const UPLOAD_PATHS = ['/api/users', '/api/classes', '/api/resources']
app.use((req, res, next) => {
  const parser = UPLOAD_PATHS.some(p => req.path.startsWith(p)) ? uploadJsonParser : defaultJsonParser
  parser(req, res, err => {
    // Express 5 dropped Express 4's guarantee that req.body is always an
    // object: with no request body at all, it stays undefined. Seventeen
    // routes open with `const { ... } = req.body`, which then throws a
    // TypeError before any of their own validation runs — a bodyless POST
    // became a 500 instead of the 400 the route would have returned.
    //
    // Defaulting here rather than in each route means every current and
    // future handler gets the Express 4 behaviour its validation was
    // written against.
    if (!err && req.body === undefined) req.body = {}
    next(err)
  })
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
app.use('/api/assignments', assignmentRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/saved-teachers', savedTeacherRoutes)
app.use('/api/account', accountRoutes)
app.use('/api/resources', resourceRoutes)
app.use('/api/university', universityRoutes)
app.use('/api/records', recordRoutes)

// Oversized bodies get rejected by body-parser before any route handler
// runs, and Express's default error page for that is an HTML stack trace —
// surface it as JSON like every other error response.
//
// The message has to cover every upload route that can land here, not just
// avatars: class materials and resource guides are PDFs, and telling someone
// their PDF is an oversized image is worse than saying nothing.
app.use((err, req, res, next) => {
  // Something already started writing the response — Express's own handler
  // is the only thing that can close it cleanly.
  if (res.headersSent) return next(err)

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That file is too large — images must be under 5MB, PDFs under 10MB' })
  }

  // Malformed or absent JSON on a request that declares application/json.
  // body-parser throws before any route runs, so no handler can catch it.
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Request body is not valid JSON' })
  }

  // Everything else. Previously this called next(err), handing the error to
  // Express's built-in handler, which replies with an HTML page — and that
  // page embeds the stack trace unless NODE_ENV === 'production'. Railway
  // does not set NODE_ENV, so production was serving file paths and internal
  // structure to anyone who sent a bad request. Log server-side, return a
  // JSON envelope shaped like every other error in this API.
  console.error(err)
  res.status(err.status || err.statusCode || 500).json({ error: 'Something went wrong' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})