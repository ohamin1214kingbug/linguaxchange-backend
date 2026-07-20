const express = require('express')
const cors = require('cors')
require('dotenv').config()

const authRoutes = require('./routes/auth')
const classRoutes = require('./routes/classes')
const creditRoutes = require('./routes/credits')
const adminRoutes = require('./routes/admin')

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/classes', classRoutes)
app.use('/api/credits', creditRoutes)
app.use('/api/admin', adminRoutes)

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
const enrollmentRoutes = require('./routes/enrollments')
app.use('/api/enrollments', enrollmentRoutes)
const reviewRoutes = require('./routes/reviews')
app.use('/api/reviews', reviewRoutes)
const userRoutes = require('./routes/users')
app.use('/api/users', userRoutes)