// Throwaway accounts and a class to test against, so nothing here ever
// touches a real member's data again.
//
//   node scripts/testFixtures.js create   # make them, print ids + tokens
//   node scripts/testFixtures.js destroy  # remove every trace
//   node scripts/testFixtures.js status   # what exists right now
//
// Three properties make this safe to run against production:
//
// 1. Emails end in .invalid, which RFC 2606 reserves as never-resolvable.
//    The app mails people on cancellation, suspension and deletion; a typo
//    in a real domain would send a stranger a "your account is suspended"
//    notice. These bounce at DNS.
// 2. The class stays `pending`. Browse requires status='approved' AND a
//    future session, so a pending class is invisible to real users no
//    matter what its date is — while POST /api/video/room, which checks
//    enrolment and timing but not class status, still lets the fixtures
//    into the room. That is what makes classroom testing possible without
//    ever publishing a fake class.
// 3. No password_hash. These accounts cannot be logged into; they are
//    driven by minting a JWT, the way the tests already work.

require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const jwt = require('jsonwebtoken')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const TEACHER_EMAIL = 'test-teacher@linguaxchange.invalid'
const STUDENT_EMAIL = 'test-student@linguaxchange.invalid'
const CLASS_TITLE = '[TEST] fixture class — not real, safe to delete'

const token = userId => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '2h' })

async function findUser(email) {
  const { data } = await supabase.from('users').select('id, email').eq('email', email).maybeSingle()
  return data
}

async function upsertUser(email, first, last, extra = {}) {
  const existing = await findUser(email)
  if (existing) return existing

  const { data, error } = await supabase
    .from('users')
    .insert([{
      email,
      first_name: first,
      last_name: last,
      nationality: 'Testland',
      bio: 'Fixture account used for testing. Not a real person.',
      is_approved: true,
      timezone: 'Europe/Madrid',
      ...extra
    }])
    .select('id, email')
    .single()

  if (error) throw new Error(`${email}: ${error.message}`)
  return data
}

async function create() {
  const teacher = await upsertUser(TEACHER_EMAIL, 'Test', 'Teacher', {
    teach_language: 'KO', teach_level: 'Native'
  })
  const student = await upsertUser(STUDENT_EMAIL, 'Test', 'Student', {
    learn_languages: ['KO']
  })

  let { data: cls } = await supabase
    .from('classes').select('id').eq('title', CLASS_TITLE).maybeSingle()

  if (!cls) {
    const { data, error } = await supabase
      .from('classes')
      .insert([{
        teacher_id: teacher.id,
        title: CLASS_TITLE,
        description: 'Created by scripts/testFixtures.js.',
        language_code: 'KO',
        level: 'A1',
        topic: 'Fixture',
        format: 'one-time',
        duration_minutes: 60,
        max_students: 5,
        status: 'pending' // never 'approved' — see the note at the top
      }])
      .select('id')
      .single()
    if (error) throw new Error(`class: ${error.message}`)
    cls = data
  }

  // Starts five minutes ago, so the classroom gate is open the moment this
  // finishes and a test does not have to wait for a class to begin.
  const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  let { data: session } = await supabase
    .from('class_sessions').select('id').eq('class_id', cls.id).maybeSingle()

  if (session) {
    await supabase.from('class_sessions').update({ session_date: startedAt }).eq('id', session.id)
  } else {
    const { data, error } = await supabase
      .from('class_sessions')
      .insert([{ class_id: cls.id, session_date: startedAt, status: 'scheduled' }])
      .select('id')
      .single()
    if (error) throw new Error(`session: ${error.message}`)
    session = data
  }

  const { data: enrolled } = await supabase
    .from('class_enrollments').select('id')
    .eq('class_session_id', session.id).eq('user_id', student.id).maybeSingle()

  if (!enrolled) {
    const { error } = await supabase
      .from('class_enrollments')
      .insert([{ class_session_id: session.id, user_id: student.id, status: 'confirmed' }])
    if (error) throw new Error(`enrollment: ${error.message}`)
  }

  console.log(`teacher   id=${teacher.id}  ${TEACHER_EMAIL}`)
  console.log(`student   id=${student.id}  ${STUDENT_EMAIL}`)
  console.log(`class     id=${cls.id}  status=pending (invisible in browse)`)
  console.log(`session   id=${session.id}  started ${startedAt} — classroom is open now`)
  console.log('')
  console.log(`TEACHER_TOKEN=${token(teacher.id)}`)
  console.log(`STUDENT_TOKEN=${token(student.id)}`)
}

async function destroy() {
  const teacher = await findUser(TEACHER_EMAIL)
  const student = await findUser(STUDENT_EMAIL)
  const { data: cls } = await supabase.from('classes').select('id').eq('title', CLASS_TITLE).maybeSingle()

  if (cls) {
    const { data: sessions } = await supabase.from('class_sessions').select('id').eq('class_id', cls.id)
    for (const s of sessions || []) {
      await supabase.from('class_enrollments').delete().eq('class_session_id', s.id)
      await supabase.from('class_sessions').delete().eq('id', s.id)
      console.log(`removed session ${s.id} and its enrollments`)
    }
    await supabase.from('classes').delete().eq('id', cls.id)
    console.log(`removed class ${cls.id}`)
  }

  for (const u of [teacher, student].filter(Boolean)) {
    // Anything a fixture may have written while being tested.
    for (const [table, column] of [['reports', 'reporter_id'], ['reports', 'reported_id'],
                                   ['notifications', 'user_id'], ['credits', 'user_id'],
                                   ['credit_transactions', 'user_id']]) {
      await supabase.from(table).delete().eq(column, u.id)
    }
    await supabase.from('users').delete().eq('id', u.id)
    console.log(`removed user ${u.id} ${u.email}`)
  }

  // The check: nothing may survive a destroy.
  const left = [await findUser(TEACHER_EMAIL), await findUser(STUDENT_EMAIL)].filter(Boolean)
  const { data: clsLeft } = await supabase.from('classes').select('id').eq('title', CLASS_TITLE).maybeSingle()
  if (left.length || clsLeft) throw new Error(`destroy left something behind: ${JSON.stringify({ left, clsLeft })}`)
  console.log('clean')
}

async function status() {
  const teacher = await findUser(TEACHER_EMAIL)
  const student = await findUser(STUDENT_EMAIL)
  const { data: cls } = await supabase.from('classes').select('id, status').eq('title', CLASS_TITLE).maybeSingle()
  console.log('teacher:', teacher || 'absent')
  console.log('student:', student || 'absent')
  console.log('class  :', cls || 'absent')
  if (teacher) console.log(`TEACHER_TOKEN=${token(teacher.id)}`)
  if (student) console.log(`STUDENT_TOKEN=${token(student.id)}`)
}

const command = process.argv[2]
const commands = { create, destroy, status }
if (!commands[command]) {
  console.error('usage: node scripts/testFixtures.js create|destroy|status')
  process.exit(1)
}
commands[command]().catch(e => { console.error(e.message); process.exit(1) })
