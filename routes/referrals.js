const express = require('express')
const router = express.Router()
const { requireAuth } = require('../middleware/auth')
const { referralStats } = require('../utils/referrals')

// GET /api/referrals — how many joined with my invite link, and how many of
// them have taken a class.
router.get('/', requireAuth, async (req, res) => {
  const stats = await referralStats(req.userId)
  if (!stats) return res.status(500).json({ error: 'Could not load your invites' })
  res.json(stats)
})

module.exports = router
