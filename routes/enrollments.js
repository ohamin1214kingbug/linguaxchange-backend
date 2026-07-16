router.post('/', async (req, res) => {
  const { user_id, class_session_id } = req.body
  try {
    // Check user has enough credits
    const { data: credit } = await supabase
      .from('credits')
      .select('balance')
      .eq('user_id', user_id)
      .single()

    if (!credit || credit.balance < 1) {
      return res.status(400).json({ error: 'Not enough credits' })
    }

    // Create a session for this class if it doesn't exist
    let sessionId = class_session_id
    const { data: existingSession } = await supabase
      .from('class_sessions')
      .select('id')
      .eq('class_id', class_session_id)
      .single()

    if (existingSession) {
      sessionId = existingSession.id
    } else {
      const { data: newSession } = await supabase
        .from('class_sessions')
        .insert([{
          class_id: class_session_id,
          session_date: new Date().toISOString(),
          status: 'scheduled'
        }])
        .select()
        .single()
      sessionId = newSession.id
    }

    // Enroll the student
    const { data, error } = await supabase
      .from('class_enrollments')
      .insert([{
        class_session_id: sessionId,
        user_id,
        status: 'confirmed',
        attended: false
      }])
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })

    // Deduct 1 credit
    await supabase
      .from('credits')
      .update({ balance: credit.balance - 1 })
      .eq('user_id', user_id)

    // Record transaction
    await supabase
      .from('credit_transactions')
      .insert([{
        user_id,
        amount: -1,
        type: 'spent',
        description: 'Joined a class'
      }])

    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})