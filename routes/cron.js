const express = require('express')
const router = express.Router()
const { sendClassReminders } = require('../utils/classReminder')

// GET/POST /api/cron/send-class-reminders
// Meant to be hit every 5-10 minutes by Railway's cron scheduler or a free
// external pinger (e.g. cron-job.org) — not by users, so it's protected by a
// shared secret (query param, since simple pingers are URL-based) rather than
// requireAuth. Both methods are supported since free cron-ping services vary
// in which one they offer. Set CRON_SECRET in the environment and configure
// the scheduler to call /api/cron/send-class-reminders?secret=<value>.
async function handleSendReminders(req, res) {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const summary = await sendClassReminders()
  res.json(summary)
}

router.get('/send-class-reminders', handleSendReminders)
router.post('/send-class-reminders', handleSendReminders)

module.exports = router
