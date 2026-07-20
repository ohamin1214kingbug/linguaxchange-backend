const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

router.get('/', async (req, res) => {
  try {
    const query = supabase
      .from('classes')
      .select('*, teacher:users!teacher_id(id, first_name, last_name, photo_url)')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })

    if (req.query.teacher_id) {
      query.eq('teacher_id', req.query.teacher_id)
    }

    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch classes' })
  }
})

router.post('/', async (req, res) => {
  const {
    teacher_id, language_code, level, topic,
    title, description, max_students, duration_minutes,
    format, recurrence_type, materials
  } = req.body

  try {
    const { data, error } = await supabase
      .from('classes')
      .insert([{
        teacher_id: parseInt(teacher_id),
        language_code,
        level,
        topic,
        title,
        description,
        max_students: parseInt(max_students),
        duration_minutes: parseInt(duration_minutes),
        format,
        status: 'pending'
      }])
      .select()
      .single()

    if (error) {
      console.log('SUPABASE ERROR:', error)
      return res.status(400).json({ error: error.message })
    }
    res.status(201).json(data)
  } catch (e) {
    console.log('CATCH ERROR:', e.message)
    res.status(500).json({ error: e.message })
  }
})

router.post('/:id/approve', async (req, res) => {
  try {
    const { error } = await supabase
      .from('classes')
      .update({ status: 'approved' })
      .eq('id', req.params.id)
    if (error) return res.status(400).json({ error: error.message })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not approve class' })
  }
})

router.post('/:id/reject', async (req, res) => {
  try {
    const { error } = await supabase
      .from('classes')
      .update({ status: 'rejected' })
      .eq('id', req.params.id)
    if (error) return res.status(400).json({ error: error.message })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not reject class' })
  }
})

module.exports = router
