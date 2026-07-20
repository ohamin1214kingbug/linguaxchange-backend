const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// GET /api/credits
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('credits')
      .select('balance')
      .eq('user_id', req.userId)
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json({ balance: data.balance })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Could not fetch credits' })
  }
})

// GET /api/credits/transactions
router.get('/transactions', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Could not fetch transactions' })
  }
})

module.exports = router
