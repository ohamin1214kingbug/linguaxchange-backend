const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// GET /api/credits?user_id=1
router.get('/', async (req, res) => {
  const { user_id } = req.query
  try {
    const { data, error } = await supabase
      .from('credits')
      .select('balance')
      .eq('user_id', user_id)
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json({ balance: data.balance })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Could not fetch credits' })
  }
})

// GET /api/credits/transactions?user_id=1
router.get('/transactions', async (req, res) => {
  const { user_id } = req.query
  try {
    const { data, error } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Could not fetch transactions' })
  }
})

module.exports = router