const express = require('express')
const router = express.Router()
const { sendClassReminders } = require('../utils/classReminder')

// POST /api/cron/send-class-reminders
// Meant to be hit every 5-10 minutes by Railway's cron scheduler or a free
// external pinger (e.g. cron-job.org) — not by users, so it's protected by a
// shared secret (query param, since cron-job.org's free tier is URL-based)
// rather than requireAuth. Set CRON_SECRET in the environment and configure
// the scheduler to call POST /api/cron/send-class-reminders?secret=<value>.
router.post('/send-class-reminders', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const summary = await sendClassReminders()
  res.json(summary)
})

module.exports = router
