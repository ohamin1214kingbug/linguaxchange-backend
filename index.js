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
const cronRoutes = require('./routes/cron')

const app = express()

// Railway terminates TLS and proxies requests through a single hop, so trust
// exactly one layer of X-Forwarded-For — needed for rate limiting (and
// req.ip generally) to see the real client IP instead of Railway's own.
app.set('trust proxy', 1)

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
app.use('/api/cron', cronRoutes)

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})